"use strict";

const fp = require("fastify-plugin");

module.exports = fp(async function (fastify, opts) {
  const defaultOrigins = "https://fron-end-proyecto-seguridad.vercel.app,https://back-end-tikets.onrender.com,https://back-end-grups.vercel.app,https://back-end-users-three.vercel.app";
  const origins = (process.env.CORS_ORIGINS || defaultOrigins)
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o);

  // Intercepta TODAS las peticiones antes del proxy
  fastify.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;

    if (origin && origins.includes(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Cookie, X-Requested-With, Accept, Origin");
      reply.header("Access-Control-Expose-Headers", "Set-Cookie, Authorization, X-Cache");
    }

    // Responde el preflight OPTIONS directamente — sin pasar al proxy
    if (request.method === "OPTIONS") {
      reply.code(204).send();
    }
  });
});
