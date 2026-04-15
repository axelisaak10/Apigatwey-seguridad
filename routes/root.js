'use strict'

module.exports = async function (fastify, opts) {
  fastify.get('/', async function (request, reply) {
    return { status: 'ok', service: 'api-gateway', message: 'API Gateway running' }
  })

  fastify.get('/health', async function (request, reply) {
    return { status: 'ok', service: 'api-gateway' }
  })
}