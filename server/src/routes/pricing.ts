import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PricingRuleDTO, DeviceType } from '@arenaze/shared';
import { query, withTransaction } from '../db.js';
import { getAuth } from '../middleware/authn.js';
import { requireRole } from '../middleware/roles.js';
import { parse } from '../lib/validate.js';
import { Err } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

interface RuleRow {
  id: string;
  device_type: DeviceType;
  rate_paise: number;
  updated_at: string;
}
const toDTO = (r: RuleRow): PricingRuleDTO => ({
  id: r.id,
  deviceType: r.device_type,
  ratePaise: r.rate_paise,
  updatedAt: r.updated_at,
});

const UpdateSchema = z.object({ ratePaise: z.number().int().nonnegative() });

export async function pricingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/pricing', { preHandler: requireRole('admin') }, async (req): Promise<PricingRuleDTO[]> => {
    const { tenantId } = getAuth(req);
    const { rows } = await query<RuleRow>(
      `SELECT id, device_type, rate_paise, updated_at FROM pricing_rules WHERE tenant_id = $1 ORDER BY device_type`,
      [tenantId],
    );
    return rows.map(toDTO);
  });

  // Update a rate; cascade it to every device of that type.
  fastify.patch('/pricing/:id', { preHandler: requireRole('admin') }, async (req): Promise<PricingRuleDTO> => {
    const { tenantId, userId } = getAuth(req);
    const { id } = req.params as { id: string };
    const body = parse(UpdateSchema, req.body);

    const rule = await withTransaction(async (client) => {
      const { rows } = await query<RuleRow>(
        `UPDATE pricing_rules SET rate_paise = $3, updated_at = now()
         WHERE id = $1 AND tenant_id = $2 RETURNING id, device_type, rate_paise, updated_at`,
        [id, tenantId, body.ratePaise],
        client,
      );
      const updated = rows[0];
      if (!updated) throw Err.notFound('Pricing rule not found');
      const cascade = await query(
        `UPDATE devices SET rate_paise = $3 WHERE tenant_id = $2 AND type = $1`,
        [updated.device_type, tenantId, body.ratePaise],
        client,
      );
      await audit(client, {
        tenantId,
        userId,
        action: 'pricing.update',
        entity: 'pricing_rule',
        entityId: id,
        meta: { deviceType: updated.device_type, ratePaise: body.ratePaise, devicesUpdated: cascade.rowCount },
      });
      return updated;
    });

    return toDTO(rule);
  });
}
