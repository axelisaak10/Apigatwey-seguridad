"use strict";

const fp = require("fastify-plugin");
const http = require("http");

module.exports = fp(async function (fastify, opts) {
  const { USERS_SERVICE_URL, API_PREFIX } = process.env;

  if (!USERS_SERVICE_URL) {
    throw new Error("USERS_SERVICE_URL is required in .env");
  }

  const prefix = `/${API_PREFIX || "api"}/auth/events`;

  fastify.get(prefix, async (req, reply) => {
    // Hijack para control total del socket
    reply.hijack();

    const token = req.query.token;
    const url = token
      ? `${USERS_SERVICE_URL}/auth/events?token=${token}`
      : `${USERS_SERVICE_URL}/auth/events`;

    const urlObj = new URL(url);

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Cookie':        req.headers.cookie || '',
        'Authorization': req.headers.authorization || '',
        'Origin':        req.headers.origin || 'http://localhost:4200',
        'Accept':        'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    };

    // Escribir headers SSE inmediatamente
    const origin = req.headers.origin || 'http://localhost:4200';
    reply.raw.writeHead(200, {
      'Content-Type':                'text/event-stream',
      'Cache-Control':               'no-cache, no-store',
      'Connection':                  'keep-alive',
      'X-Accel-Buffering':           'no',           // Evita buffering en nginx
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
    });

    // Enviar retry sugerido al cliente (3 seg)
    reply.raw.write('retry: 3000\n\n');

    let proxyReq = null;
    let clientClosed = false;

    const startProxy = () => {
      if (clientClosed) return;

      proxyReq = http.request(reqOptions, (proxyRes) => {
        console.log(`[SSE] Backend conectado, status: ${proxyRes.statusCode}`);

        if (proxyRes.statusCode !== 200) {
          console.error(`[SSE] Backend rechazó conexión SSE: ${proxyRes.statusCode}`);
          if (!clientClosed) {
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: proxyRes.statusCode })}\n\n`);
          }
          return;
        }

        // Pipe directo del backend al cliente
        proxyRes.on('data', (chunk) => {
          if (!clientClosed && !reply.raw.writableEnded) {
            reply.raw.write(chunk);
          }
        });

        proxyRes.on('end', () => {
          console.log('[SSE] Backend cerró la conexión SSE');
          if (!clientClosed && !reply.raw.writableEnded) {
            reply.raw.end();
          }
        });

        proxyRes.on('error', (err) => {
          console.error('[SSE] Error en respuesta del backend:', err.message);
        });
      });

      proxyReq.on('error', (err) => {
        console.error('[SSE] Error conectando con backend:', err.message);
        if (!clientClosed && !reply.raw.writableEnded) {
          // Notificar al cliente del error para que reconecte
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'Backend unreachable' })}\n\n`);
        }
      });

      proxyReq.on('close', () => {
        if (!clientClosed) {
          console.log('[SSE] Proxy connection closed');
        }
      });

      proxyReq.end();
    };

    // Cleanup cuando el cliente desconecta
    reply.raw.on('close', () => {
      console.log('[SSE] Client connection closed');
      clientClosed = true;
      if (proxyReq && !proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });

    reply.raw.on('error', (err) => {
      console.error('[SSE] Raw response error:', err.message);
      clientClosed = true;
      if (proxyReq && !proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });

    startProxy();
  });
});
