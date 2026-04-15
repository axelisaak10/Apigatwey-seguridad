"use strict";

const fp = require("fastify-plugin");

function extractAuthFromCookie(cookies) {
  if (!cookies) return null;
  const cookieParts = cookies.split(';').map(c => c.trim());
  const authCookie = cookieParts.find(c => c.startsWith('Authentication='));
  if (authCookie) {
    const token = authCookie.substring('Authentication='.length);
    return `Bearer ${decodeURIComponent(token)}`;
  }
  return null;
}

module.exports = fp(async function (fastify, opts) {
  const { TICKETS_SERVICE_URL, API_PREFIX } = process.env;

  if (!TICKETS_SERVICE_URL) {
    throw new Error("TICKETS_SERVICE_URL is required in .env");
  }

  const prefix = API_PREFIX || "api";

  // Reescribe los headers hacia el microservicio de tikets:
  // - Elimina la cookie (el token ya va en Authorization)
  // - Extrae el token JWT de la cookie si no viene en Authorization
  // - Desactiva compresión gzip (identity) para evitar problemas con el stream
  const rewriteHeaders = (originalReq, headers) => {
    const cookies = originalReq.headers.cookie || "";
    let authHeader = originalReq.headers.authorization || "";

    if (!authHeader) {
      authHeader = extractAuthFromCookie(cookies) || "";
    }

    return {
      ...headers,
      cookie: "",
      authorization: authHeader,
      host: new URL(TICKETS_SERVICE_URL).host,
      'accept-encoding': 'identity',
    };
  };

  // Ping/wake-up: despierta el servicio de tikets en Render
  fastify.register(require("@fastify/http-proxy"), {
    upstream: TICKETS_SERVICE_URL,
    prefix: `/${prefix}/tickets/ping`,
    rewritePrefix: "/health",
    http2: false,
    replyOptions: {
      rewriteRequestHeaders: rewriteHeaders,
    },
  });

  // Proxy para /api/tickets/estados -> /api/v1/estados
  fastify.register(require("@fastify/http-proxy"), {
    upstream: TICKETS_SERVICE_URL,
    prefix: `/${prefix}/tickets/estados`,
    rewritePrefix: "/api/v1/estados",
    http2: false,
    replyOptions: {
      rewriteRequestHeaders: rewriteHeaders,
    },
  });

  // Proxy para /api/tickets/prioridades -> /api/v1/prioridades
  fastify.register(require("@fastify/http-proxy"), {
    upstream: TICKETS_SERVICE_URL,
    prefix: `/${prefix}/tickets/prioridades`,
    rewritePrefix: "/api/v1/prioridades",
    http2: false,
    replyOptions: {
      rewriteRequestHeaders: rewriteHeaders,
    },
  });

  // Proxy principal para /api/tickets/* (CRUD de tickets)
  fastify.register(require("@fastify/http-proxy"), {
    upstream: TICKETS_SERVICE_URL,
    prefix: `/${prefix}/tickets`,
    rewritePrefix: "/api/v1/tickets",
    http2: false,
    replyOptions: {
      rewriteRequestHeaders: rewriteHeaders,
    },
  });

  // Proxy para /api/comentarios -> /api/v1/comentarios
  fastify.register(require("@fastify/http-proxy"), {
    upstream: TICKETS_SERVICE_URL,
    prefix: `/${prefix}/comentarios`,
    rewritePrefix: "/api/v1/comentarios",
    http2: false,
    replyOptions: {
      rewriteRequestHeaders: rewriteHeaders,
    },
  });
});
