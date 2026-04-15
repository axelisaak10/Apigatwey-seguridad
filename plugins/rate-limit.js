"use strict";

const fp = require("fastify-plugin");

module.exports = fp(async function (fastify, opts) {
  await fastify.register(require("@fastify/rate-limit"), {
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      // Priorizar IP real (detrás de proxy/load balancer)
      return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
             req.headers["x-real-ip"] ||
             req.ip;
    },
    // Excluir SSE/events (conexiones long-lived)
    allowList: (req) => {
      if (req.method === 'OPTIONS') return true;
      const path = req.url?.split("?")[0] || "";
      return path.includes("/events") || path.includes("/sse");
    },
    // Respuesta 429 en formato JSON estándar del gateway
    errorResponseBuilder: (req, context) => {
      return {
        statusCode: 429,
        intOpCode: "api-gateway-429",
        data: [
          {
            message: "Too many requests",
            error: "Rate Limit Exceeded",
            detail: `Has superado el límite de ${context.max} solicitudes por ${context.after}. Intenta de nuevo después.`,
            retryAfter: context.after,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    },
    // Headers informativos
    addHeadersOnExceeding: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
    },
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
  });

  fastify.log.info("[GATEWAY] Rate limiting activo: 100 req/min por IP");
});
