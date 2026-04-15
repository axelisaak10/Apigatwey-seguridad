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

        console.log(`[PROXY-GROUPS] [${originalReq.method}] ${originalReq.url}`);
        console.log(`[PROXY-GROUPS] Original Auth Header: ${authHeader ? "PRESENT" : "MISSING"}`);
        console.log(`[PROXY-GROUPS] Original Cookie Header: ${cookies ? "PRESENT" : "MISSING"}`);

        // Si hay cookie pero no hay authHeader, extraer el token de la cookie
        if (!authHeader && cookies) {
          const cookieParts = cookies.split(';').map(c => c.trim());
          const authCookie = cookieParts.find(c => c.startsWith('Authentication='));
          if (authCookie) {
            const token = authCookie.substring('Authentication='.length);
            authHeader = `Bearer ${decodeURIComponent(token)}`;
            console.log(`[PROXY-GROUPS] Extracted token from cookie. Length: ${token.length}`);
          } else {
            console.log("[PROXY-GROUPS] 'Authentication' cookie NOT found in cookie string.");
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
        return proxyRes.headers;
      },
    },
  });
});
