"use strict";

const fp = require("fastify-plugin");

const SERVICE_VALIDATION = {
  "/api/auth": { prefix: "microservicio-users", serviceName: "users" },
  "/api/users": { prefix: "microservicio-users", serviceName: "users" },
  "/api/groups": { prefix: "microservicio-groups", serviceName: "groups" },
  "/api/tickets": { prefix: "microservicio-tickets", serviceName: "tickets" },
};

function validateResponseSchema(body, expectedPrefix) {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Response is not a valid JSON object" };
  }

  if (typeof body.statusCode !== "number") {
    return { valid: false, error: "Missing or invalid statusCode" };
  }

  if (typeof body.intOpCode !== "string") {
    return { valid: false, error: "Missing or invalid intOpCode" };
  }

  if (!body.data || (typeof body.data !== "object" && !Array.isArray(body.data))) {
    return { valid: false, error: "Missing or invalid data (must be array or object)" };
  }

  const expectedPattern = new RegExp(`^${expectedPrefix}\\d{3}$`);
  if (!expectedPattern.test(body.intOpCode)) {
    return {
      valid: false,
      error: `Invalid intOpCode format. Expected pattern: ${expectedPrefix}xxx`,
    };
  }

  return { valid: true };
}

async function validateSchemaPlugin(fastify, opts) {
  fastify.addHook("onSend", async function (request, reply, payload) {
    const path = request.url;

    let matchedService = null;
    for (const [routePrefix, config] of Object.entries(SERVICE_VALIDATION)) {
      if (path.startsWith(routePrefix)) {
        matchedService = config;
        break;
      }
    }

    if (!matchedService) {
      return payload;
    }

    if (!payload || payload === "") {
      return payload;
    }

    if (reply.statusCode >= 400) {
      return payload;
    }

    let parsedBody;
    try {
      if (typeof payload === "string") {
        parsedBody = JSON.parse(payload);
      } else {
        return payload;
      }
    } catch (e) {
      return payload;
    }

    const validation = validateResponseSchema(
      parsedBody,
      matchedService.prefix,
    );
    if (!validation.valid) {
      fastify.log.warn(
        {
          path,
          expectedPrefix: matchedService.prefix,
          intOpCode: parsedBody?.intOpCode,
          error: validation.error,
        },
        "Invalid response schema from upstream",
      );

      reply.code(502);
      return JSON.stringify({
        statusCode: 502,
        intOpCode: "microservicio-gateway502",
        data: [
          {
            message: "Invalid response schema from upstream service",
            details: validation.error,
          },
        ],
      });
    }

    return payload;
  });
}

module.exports = fp(validateSchemaPlugin, {
  name: "validate-schema-plugin",
});
