"use strict";

const fp = require("fastify-plugin");

// TTL en milisegundos por ruta (sin query string)
const CACHE_TTL = {
  '/api/auth/me': 30000,           // 30s — datos de perfil del usuario
  '/api/auth/permissions': 30000,  // 30s — permisos del usuario
  '/api/users/permissions/list': 60000, // 60s — lista global de permisos (casi estática)
  '/api/users': 15000,             // 15s — lista de usuarios
};

const memoryCache = new Map();

/**
 * Clave de caché: path + Authorization header
 * (cada usuario tiene su caché separada)
 */
function getCacheKey(urlPath, authHeader) {
  return `${urlPath}:${authHeader || ''}`;
}

/**
 * Intenta servir desde caché.
 * Retorna true si respondió desde caché, false si es MISS.
 */
function tryCacheHit(req, reply) {
  if (req.method !== 'GET') return false;

  const urlPath = req.url.split('?')[0];
  const ttl = CACHE_TTL[urlPath];
  if (!ttl) return false;

  const authHeader = req.headers.authorization || '';
  const cacheKey = getCacheKey(urlPath, authHeader);
  const entry = memoryCache.get(cacheKey);

  if (entry && Date.now() <= entry.expiresAt) {
    console.log(`[CACHE] HIT: ${urlPath} (${Math.round((entry.expiresAt - Date.now()) / 1000)}s restantes)`);
    reply
      .code(200)
      .header('Content-Type', 'application/json')
      .header('X-Cache', 'HIT')
      .header('Access-Control-Allow-Origin', req.headers.origin || '*')
      .header('Access-Control-Allow-Credentials', 'true')
      .send(entry.data);
    return true;
  }

  console.log(`[CACHE] MISS: ${urlPath}`);
  return false;
}

/**
 * Guarda una respuesta en caché.
 * Llamado por el proxy después de recibir la respuesta del backend.
 */
function setCacheEntry(urlPath, authHeader, data) {
  const ttl = CACHE_TTL[urlPath];
  if (!ttl) return;

  const cacheKey = getCacheKey(urlPath, authHeader);
  memoryCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + ttl,
  });
  console.log(`[CACHE] SET: ${urlPath} (TTL: ${ttl / 1000}s)`);
}

/**
 * Invalida todas las entradas de caché que comiencen con un prefijo.
 * Útil después de PATCH/POST/DELETE.
 */
function invalidateCacheByPrefix(prefix) {
  let count = 0;
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
      count++;
    }
  }
  if (count > 0) {
    console.log(`[CACHE] INVALIDATED: ${count} entradas con prefijo ${prefix}`);
  }
}

module.exports = fp(async function (fastify, opts) {
  // Exponer utilidades al servidor para que los proxies las usen
  fastify.decorate('cache', {
    tryHit: tryCacheHit,
    set: setCacheEntry,
    invalidate: invalidateCacheByPrefix,
    ttl: CACHE_TTL,
  });

  // Hook global: intercepta TODAS las GET requests antes de que lleguen al endpoint final
  fastify.addHook('preHandler', async (req, reply) => {
    if (req.method !== 'GET') return;

    const urlPath = req.url.split('?')[0];
    if (!CACHE_TTL[urlPath]) return; // Ruta no cacheable, skip rápido

    tryCacheHit(req, reply); // Si hay HIT, reply.sent = true y Fastify no continúa
  });
});
