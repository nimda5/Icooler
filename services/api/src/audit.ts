// Журнал аудита (V-005): каждое изменение — в той же транзакции, что и само действие.
import type pg from 'pg';
import type { RequestContext } from './auth/context.ts';

export interface AuditEntry {
  tenantId: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function audit(c: pg.PoolClient, ctx: Pick<RequestContext, 'userId' | 'ip'>, e: AuditEntry): Promise<void> {
  await c.query(
    `insert into app.audit_log (tenant_id, user_id, actor, action, object_type, object_id, before, after, ip)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [e.tenantId, ctx.userId, ctx.userId ? 'user' : 'api', e.action, e.objectType, e.objectId ?? null,
      e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after), ctx.ip],
  );
}
