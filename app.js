"use strict";

require("dotenv").config();

const path = require("node:path");
const AutoLoad = require("@fastify/autoload");

const options = {};

module.exports = async function (fastify, opts) {
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, "plugins"),
    options: Object.assign({}, opts),
  });

  fastify.register(AutoLoad, {
    dir: path.join(__dirname, "routes"),
    options: Object.assign({}, opts),
  });
};

// Para compatibilidad con despliegues directos (como Render con 'node app.js')
if (require.main === module) {
  const fastify = require("fastify")({
    logger: true,
    trustProxy: true,
  });

  const start = async () => {
    try {
      // Registrar la propia aplicación (que es un plugin)
      await fastify.register(module.exports);

      const port = process.env.PORT || process.env.apigetPORT || 3008;
      const host = "0.0.0.0"; // Importante para Render/Docker

      await fastify.listen({ port: parseInt(port), host });
      console.log(`[Gateway] Servidor escuchando en http://${host}:${port}`);
    } catch (err) {
      fastify.log.error(err);
      process.exit(1);
    }
  };

  start();
}

module.exports.options = options;
