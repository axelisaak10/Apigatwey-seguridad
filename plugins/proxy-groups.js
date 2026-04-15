"use strict";

const fp = require("fastify-plugin");

module.exports = fp(async function (fastify, opts) {
  const { GROUPS_SERVICE_URL, API_PREFIX } = process.env;

  if (!GROUPS_SERVICE_URL) {
    throw new Error("GROUPS_SERVICE_URL is required in .env");
  }

  const prefix = `/${API_PREFIX || "api"}/groups`;

  fastify.register(require("@fastify/http-proxy"), {
    upstream: GROUPS_SERVICE_URL,
    prefix: prefix,
    rewritePrefix: "/groups",
    http2: false,
    acceptExposedHeaders: ["Set-Cookie", "Authorization"],
    disableCache: true,
    replyOptions: {
      rewriteRequestHeaders: (originalReq, headers) => {
        const cookies = originalReq.headers.cookie || "";
        let authHeader = originalReq.headers.authorization || "";

        console.log("[PROXY-GROUPS] Request:", {
          method: originalReq.method,
          path: originalReq.url,
          hasCookie: !!cookies,
          hasAuthHeader: !!authHeader,
        });

        // Si hay cookie pero no hay authHeader, extraer el token de la cookie
        if (!authHeader && cookies) {
          const cookieParts = cookies.split(';').map(c => c.trim());
          const authCookie = cookieParts.find(c => c.startsWith('Authentication='));
          if (authCookie) {
            const token = authCookie.substring('Authentication='.length);
            authHeader = `Bearer ${decodeURIComponent(token)}`;
            console.log("[PROXY-GROUPS] Token extracted from cookie:", {
              tokenLength: token.length,
              tokenPreview: token.substring(0, 30) + "..."
            });
          }
        }

        return {
          ...headers,
          cookie: "",  // No necesitamos la cookie, solo el header Authorization
          authorization: authHeader,
          host: new URL(GROUPS_SERVICE_URL).host,
        };
      },
      getProxyResponseHeaders: (proxyRes) => {
        const headers = {};
        if (proxyRes.headers["content-type"]) {
          headers["content-type"] = proxyRes.headers["content-type"];
        }
        if (proxyRes.headers["authorization"]) {
          headers["authorization"] = proxyRes.headers["authorization"];
        }
        return headers;
      },
    },
  });
});
