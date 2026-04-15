"use strict";

const fp = require("fastify-plugin");

const CACHEABLE_PATHS = new Set(["/api/users", "/api/users/permissions/list"]);

module.exports = fp(async function (fastify, opts) {
  const { USERS_SERVICE_URL, API_PREFIX } = process.env;

  if (!USERS_SERVICE_URL) {
    throw new Error("USERS_SERVICE_URL is required in .env");
  }

  const prefix = `/${API_PREFIX || "api"}/users`;

  fastify.register(require("@fastify/http-proxy"), {
    upstream: USERS_SERVICE_URL,
    prefix: prefix,
    rewritePrefix: "/users",
    http2: false,
    acceptExposedHeaders: ["Set-Cookie", "Authorization"],
    disableCache: true,
    replyOptions: {
      rewriteRequestHeaders: (originalReq, headers) => {
        const cookies = originalReq.headers.cookie || "";
        let authHeader = originalReq.headers.authorization || "";

        // Si hay cookie pero no hay authHeader, extraer el token de la cookie
        if (!authHeader && cookies) {
          const cookieParts = cookies.split(';').map(c => c.trim());
          const authCookie = cookieParts.find(c => c.startsWith('Authentication='));
          if (authCookie) {
            const token = authCookie.substring('Authentication='.length);
            authHeader = `Bearer ${decodeURIComponent(token)}`;
          }
        }

        return {
          ...headers,
          cookie: "",
          authorization: authHeader,
          host: new URL(USERS_SERVICE_URL).host,
        };
      },
      getProxyResponseHeaders: (proxyRes) => {
        return proxyRes.headers;
      },
      onResponse: (request, reply, res) => {
        const urlPath = request.url?.split("?")[0] || "";
        const statusCode = res.statusCode;
        const contentEncoding = res.headers["content-encoding"];

        if (
          request.method === "GET" &&
          statusCode === 200 &&
          CACHEABLE_PATHS.has(urlPath) &&
          !contentEncoding // Solo cachear si no hay compresión, para evitar corrupción
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
          return;
        }

        if (
          ["POST", "PATCH", "PUT", "DELETE"].includes(request.method) &&
          statusCode < 400
        ) {
          fastify.cache.invalidate("/api/users");
          fastify.cache.invalidate("/api/auth/me");
          fastify.cache.invalidate("/api/auth/permissions");
        }

        reply.send(res.stream);
      },
    },
  });
});
