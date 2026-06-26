import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@arenaze/shared';
import { config } from './config.js';
import { pool } from './db.js';
import { ApiError } from './lib/errors.js';
import { authn } from './middleware/authn.js';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/devices.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { availabilityRoutes } from './routes/availability.js';
import { bookingRoutes } from './routes/bookings.js';
import { customerRoutes } from './routes/customers.js';
import { pricingRoutes } from './routes/pricing.js';
import { analyticsRoutes } from './routes/analytics.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.webOrigin, credentials: true });

// Every error leaves as the shared ApiErrorBody envelope.
app.setErrorHandler((err, req, reply) => {
  if (err instanceof ApiError) {
    reply.code(err.httpStatus).send(err.toBody());
    return;
  }
  if (err instanceof ZodError) {
    const body: ApiErrorBody = { error: { code: 'validation', message: 'Invalid request', details: err.issues } };
    reply.code(400).send(body);
    return;
  }
  if ((err as { validation?: unknown }).validation) {
    const body: ApiErrorBody = { error: { code: 'validation', message: (err as Error).message } };
    reply.code(400).send(body);
    return;
  }
  req.log.error(err);
  const body: ApiErrorBody = { error: { code: 'internal', message: 'Internal server error' } };
  reply.code(500).send(body);
});

app.setNotFoundHandler((_req, reply) => {
  const body: ApiErrorBody = { error: { code: 'not_found', message: 'Route not found' } };
  reply.code(404).send(body);
});

// Public
app.get('/api/health', async () => ({ ok: true }));
await app.register(authRoutes, { prefix: '/api/auth' });

// Protected: authn runs for every route in this scope; admin gates are per-route.
await app.register(
  async (scope) => {
    scope.addHook('preHandler', authn);
    await scope.register(deviceRoutes);
    await scope.register(dashboardRoutes);
    await scope.register(availabilityRoutes);
    await scope.register(bookingRoutes);
    await scope.register(customerRoutes);
    await scope.register(pricingRoutes);
    await scope.register(analyticsRoutes);
  },
  { prefix: '/api' },
);

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Arenaze API listening on http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void (async () => {
      await app.close();
      await pool.end();
      process.exit(0);
    })();
  });
}
