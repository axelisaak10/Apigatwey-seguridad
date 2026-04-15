"use strict";

const fp = require("fastify-plugin");
const jwt = require("jsonwebtoken");

const ENDPOINT_PERMISOS = {
  "/api/auth/login": [],
  "/api/auth/register": [],
  "/api/auth/forgot-password": [],

  "/api/auth/me": ["user:profile:view"],
  "/api/auth/profile": ["user:profile:edit"],
  "/api/auth/logout": [],
  "/api/auth/permissions": [],
  "/api/auth/refresh": [],
  "/api/auth/revoke": [],
  "/api/auth/events": [],

  "/api/users": ["superadmin", "user:manage", "group:view", "group:manage", "group:add", "group:add:miembro"],
  "/api/users/search": ["superadmin", "user:manage", "group:view", "group:manage", "group:add", "group:add:miembro"],
  "/api/users/permissions/list": [],

  "/api/groups/permissions": ["group:view", "superadmin"],

  "/api/tickets": ["ticket:view", "superadmin"],
  "/api/tickets/permisos": ["ticket:view", "superadmin"],
  "/api/prioridades": ["ticket:view", "superadmin"],
  "/api/estados": ["ticket:view", "superadmin"],
  "/api/comentarios": ["ticket:view", "superadmin"],
};

function buildErrorResponse(statusCode, message, errorType, path) {
  return {
    statusCode,
    intOpCode: `api-gateway-${statusCode}`,
    data: [
      {
        message,
        error: errorType,
        path,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function getMethodPermissions(method, path) {
  // Endpoints de grupos - NO verificar permisos a nivel Gateway
  // El backend-groups filtra los grupos según los permisos del usuario en cada grupo
  if (path === "/api/groups" || path === "/api/groups/members") {
    return [];
  }

  if (path.startsWith("/api/groups/") && path.includes("/")) {
    const basePath = path.split("/").slice(0, 4).join("/");
    if (path.includes("/members")) {
      return method === "DELETE" ? [] : ["group:manage", "superadmin"];
    }
    if (path.includes("/permissions")) {
      return method === "GET"
        ? ["group:view", "superadmin"]
        : ["group:manage", "superadmin"];
    }
    if (path.match(/\/api\/groups\/[a-f0-9-]+$/i)) {
      return method === "GET"
        ? ["group:view", "superadmin"]
        : method === "PUT"
          ? ["group:edit", "superadmin"]
          : method === "DELETE"
            ? ["group:delete", "superadmin"]
            : [];
    }
  }

  // Endpoints de tickets - NO verificar permisos a nivel Gateway
  // El backend-tickets filtra por grupos donde el usuario tiene permiso Y por asignado_id
  if (path === "/api/tickets" || path === "/api/prioridades" || path === "/api/estados") {
    return [];
  }

  // Endpoints de tickets con ID
  if (path.startsWith("/api/tickets/") && path.includes("/")) {
    if (path.match(/\/api\/tickets\/[a-f0-9-]+$/i)) {
      return [];
    }
    if (path.includes("/estado")) {
      return [];
    }
  }

  // Endpoints de comentarios
  if (path === "/api/comentarios") {
    return [];
  }

  // Endpoints de prioridades y estados (solo lectura) - ya cubierto arriba

  return ENDPOINT_PERMISOS[path] || null;
}

module.exports = fp(async function (fastify, opts) {
  const JWT_SECRET = process.env.JWT_SECRET || "super-secret-jwt-key";

  fastify.addHook("preHandler", async (req, reply) => {
    const path = req.url.split("?")[0];
    const method = req.method;

    // Permitir solicitudes OPTIONS (preflight CORS) sin validación
    if (method === "OPTIONS") {
      return;
    }

    const requiredPermisos = getMethodPermissions(method, path);

    if (!requiredPermisos) return;
    if (requiredPermisos.length === 0) return;

    let token = req.headers.authorization?.replace("Bearer ", "");
    if (!token && req.headers.cookie) {
      const match = req.headers.cookie.match(/Authentication=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    console.log("[GATEWAY-PERMISSIONS] Token extracted:", {
      hasToken: !!token,
      tokenLength: token ? token.length : 0,
      from: req.headers.authorization ? "header" : "cookie",
    });

    if (!token) {
      reply
        .code(401)
        .send(
          buildErrorResponse(
            401,
            "Token no proporcionado",
            "Unauthorized",
            path,
          ),
        );
      return;
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      reply
        .code(401)
        .send(
          buildErrorResponse(
            401,
            "Token inválido o expirado",
            "Unauthorized",
            path,
          ),
        );
      return;
    }

    const globalPerms = decoded.permisos_globales || [];
    const groupPerms = decoded.grupos?.flatMap((g) => g.permisos || []) || [];
    const userPermisos = [...new Set([...globalPerms, ...groupPerms])];

    console.log("[GATEWAY-PERMISSIONS] Token decoded:", {
      path,
      method,
      requiredPermisos,
      globalPerms,
      groupPerms,
      userPermisos,
    });

    const hasPermiso = requiredPermisos.some((p) => userPermisos.includes(p));

    console.log("[GATEWAY-PERMISSIONS] Permission check:", {
      required: requiredPermisos,
      has: userPermisos,
      hasAccess: hasPermiso,
    });

    if (!hasPermiso) {
      reply
        .code(403)
        .send(
          buildErrorResponse(
            403,
            `Permiso denegado. Requerido: ${requiredPermisos.join(" | ")}`,
            "Forbidden",
            path,
          ),
        );
      return;
    }

    req.user = decoded;
  });
});
