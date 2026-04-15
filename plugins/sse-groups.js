"use strict";

const fp = require("fastify-plugin");
const http = require("http");

module.exports = fp(async function (fastify, opts) {
  const { GROUPS_SERVICE_URL, API_PREFIX } = process.env;

  if (!GROUPS_SERVICE_URL) {
    throw new Error("GROUPS_SERVICE_URL is required in .env");
  }

  const prefix = `/${API_PREFIX || "api"}/groups/events`;

  fastify.get(prefix, async (req, reply) => {
    reply.hijack();

    const token = req.query.token;
    const url = token
      ? `${GROUPS_SERVICE_URL}/auth/events?token=${token}`
      : `${GROUPS_SERVICE_URL}/auth/events`;

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

    const origin = req.headers.origin || 'http://localhost:4200';
    reply.raw.writeHead(200, {
      'Content-Type':                'text/event-stream',
      'Cache-Control':               'no-cache, no-store',
      'Connection':                  'keep-alive',
      'X-Accel-Buffering':           'no',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
    });

    reply.raw.write('retry: 3000\n\n');

    let proxyReq = null;
    let clientClosed = false;

    const startProxy = () => {
      if (clientClosed) return;

      proxyReq = http.request(reqOptions, (proxyRes) => {
        console.log(`[SSE-GROUPS] Backend connected, status: ${proxyRes.statusCode}`);

        if (proxyRes.statusCode !== 200) {
          console.error(`[SSE-GROUPS] Backend rejected SSE connection: ${proxyRes.statusCode}`);
          if (!clientClosed) {
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: proxyRes.statusCode })}\n\n`);
          }
          return;
        }

        proxyRes.on('data', (chunk) => {
          if (!clientClosed && !reply.raw.writableEnded) {
            reply.raw.write(chunk);
          }
        });

        proxyRes.on('end', () => {
          console.log('[SSE-GROUPS] Backend closed SSE connection');
          if (!clientClosed && !reply.raw.writableEnded) {
            reply.raw.end();
          }
        });

        proxyRes.on('error', (err) => {
          console.error('[SSE-GROUPS] Backend response error:', err.message);
        });
      });

      proxyReq.on('error', (err) => {
        console.error('[SSE-GROUPS] Error connecting to backend:', err.message);
        if (!clientClosed && !reply.raw.writableEnded) {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'Backend unreachable' })}\n\n`);
        }
      });

      proxyReq.on('close', () => {
        if (!clientClosed) {
          console.log('[SSE-GROUPS] Proxy connection closed');
        }
      });

      proxyReq.end();
    };

    reply.raw.on('close', () => {
      console.log('[SSE-GROUPS] Client connection closed');
      clientClosed = true;
      if (proxyReq && !proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });

    reply.raw.on('error', (err) => {
      console.error('[SSE-GROUPS] Raw response error:', err.message);
      clientClosed = true;
      if (proxyReq && !proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });

    startProxy();
  });
});