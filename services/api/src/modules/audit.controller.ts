// Журнал аудита (V-005): фильтр по пользователю, действию, объекту и периоду. Admin, Exec — просмотр (§7.1).
import { Controller, Inject, Query } from '@nestjs/common';
import { Ctx, Op } from '../http/op.ts';
import { Db } from '../db/db.service.ts';
import type { RequestContext } from '../auth/context.ts';
import { cursorTs, decodeCursor, encodeCursor } from './accounts.ts';

@Controller()
export class AuditController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Op('listAudit', 200)
  async list(@Ctx() ctx: RequestContext, @Query() q: Record<string, string | number | undefined>) {
    const limit = Number(q['limit'] ?? 50);
    const cur = decodeCursor(q['cursor'] as string | undefined);
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const where = ['tenant_id = app.current_tenant()'];
      const args: unknown[] = [];
      const arg = (v: unknown) => { args.push(v); return `$${args.length}`; };
      if (q['from']) where.push(`at >= ${arg(q['from'])}::timestamptz`);
      if (q['to']) where.push(`at < ${arg(q['to'])}::timestamptz`);
      if (q['user_id']) where.push(`user_id = ${arg(q['user_id'])}::uuid`);
      if (q['action']) where.push(`action = ${arg(q['action'])}`);
      if (q['object_type']) where.push(`object_type = ${arg(q['object_type'])}`);
      if (q['object_id']) where.push(`object_id = ${arg(q['object_id'])}`);
      if (cur) where.push(`(at, id) < (${arg(cur[0])}::timestamptz, ${arg(cur[1])}::uuid)`);
      const rows = (await c.query(
        `select id, at, user_id, action, object_type, object_id, before, after, ip, ${cursorTs('at')} from app.audit_log
         where ${where.join(' and ')} order by at desc, id desc limit ${limit + 1}`, args)).rows;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => ({ id: r.id, at: r.at.toISOString(), user_id: r.user_id, action: r.action, object_type: r.object_type,
          object_id: r.object_id, before: r.before, after: r.after, ip: r.ip })),
        next_cursor: rows.length > limit && last ? encodeCursor(last) : null,
      };
    });
  }
}
