"use strict";

const fp = require("fastify-plugin");

// Rutas GET cacheables para el proxy de /auth
const CACHEABLE_PATHS = new Set([
  "/api/auth/me",
  // '/api/auth/permissions', // NO cachear - siempre consultar BD para permisos actualizados
]);

// Rutas que al ser escritas invalidan caché
const INVALIDATE_ON_WRITE = {
  profile: ["/api/auth/me", "/api/auth/permissions"],
  logout: ["/api/auth/me", "/api/auth/permissions"],
};

module.exports = fp(async function (fastify, opts) {
  const { USERS_SERVICE_URL, API_PREFIX } = process.env;

  if (!USERS_SERVICE_URL) {
    throw new Error("USERS_SERVICE_URL is required in .env");
  }

  const prefix = `/${API_PREFIX || "api"}/auth`;

  fastify.register(require("@fastify/http-proxy"), {
    upstream: USERS_SERVICE_URL,
    prefix: prefix,
    rewritePrefix: "/auth",
    http2: false,
    acceptExposedHeaders: ["Set-Cookie", "Authorization"],
    disableCache: true,
    replyOptions: {
      rewriteRequestHeaders: (originalReq, headers) => {
        const cookies = originalReq.headers.cookie || "";
        const authHeader = originalReq.headers.authorization || "";
        return {
          ...headers,
          cookie: cookies,
          authorization: authHeader,
        };
      },

      // onResponse(request, reply, res) — firma de @fastify/reply-from
      // res.stream = body como stream, res.statusCode = HTTP status
      onResponse: (request, reply, res) => {
        const urlPath = request.url?.split("?")[0] || "";
        const statusCode = res.statusCode;

        // ── Guardar en CACHÉ si GET 200 en ruta cacheable ──
        if (
          request.method === "GET" &&
          statusCode === 200 &&
          CACHEABLE_PATHS.has(urlPath)
        ) {
          const chunks = [];
          res.stream.on("data", (chunk) => chunks.push(chunk));
          res.stream.on("end", () => {
            try {
              const body = Buffer.concat(chunks).toString("utf8");
              const authHeader = request.headers.authorization || "";
              fastify.cache.set(urlPath, authHeader, body);
              reply.header("X-Cache", "MISS").code(statusCode).send(body);
            } catch (e) {
              reply.code(statusCode).send("");
            }
          });
          res.stream.on("error", () => reply.code(statusCode).send(""));
          return; // IMPORTANTE: no llamar reply.send abajo
        }

        // ── Invalidar caché tras escrituras exitosas ──
        if (
          ["POST", "PATCH", "PUT", "DELETE"].includes(request.method) &&
          statusCode < 400
        ) {
          const parts = urlPath.split("/");
          const lastSegment = parts[parts.length - 1];
          const toInvalidate = INVALIDATE_ON_WRITE[lastSegment] || [];
          for (const path of toInvalidate) {
            fastify.cache.invalidate(path);
          }
        }

        // Respuesta normal (sin caché)
        reply.send(res.stream);
      },
    },
  });
});
