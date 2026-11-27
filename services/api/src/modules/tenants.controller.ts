// Создание арендатора и приглашение его первого Admin — SIG Administrator (§2, §7.1).
import { Body, Controller, Inject } from '@nestjs/common';
import { Ctx, Op } from '../http/op.ts';
import { conflict } from '../http/problem.ts';
import { Db } from '../db/db.service.ts';
import { CONFIG, MAILER } from '../tokens.ts';
import type { Config } from '../config.ts';
import type { Mailer } from '../mail.ts';
import type { RequestContext } from '../auth/context.ts';
import { audit } from '../audit.ts';
import { deliver, issueToken, loadUser } from './accounts.ts';

@Controller()
export class TenantsController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  @Op('createTenant', 201)
  async create(@Ctx() ctx: RequestContext, @Body() b: { name: string; code: string; admin_email: string; admin_name: string }) {
    const { out, mail } = await this.db.tx({ tenantId: null, global: true }, async (c) => {
      if ((await c.query(`select 1 from app.tenant where code = $1`, [b.code])).rowCount) throw conflict('Код арендатора занят');
      if ((await c.query(`select * from app.auth_lookup_email($1)`, [b.admin_email])).rowCount) throw conflict('Учётная запись с таким e-mail уже есть');
      const t = (await c.query(`insert into app.tenant (name, code) values ($1, $2) returning id, name, code, created_at`, [b.name, b.code])).rows[0];
      await c.query(`select set_config('app.tenant_id', $1, true)`, [t.id]);
      const id = (await c.query(`insert into app.app_user (tenant_id, email, name, status) values ($1, $2, $3, 'invited') returning id`,
        [t.id, b.admin_email, b.admin_name])).rows[0].id;
      await c.query(`insert into app.role_assignment (user_id, tenant_id, role, assigned_by) values ($1, $2, 'admin', $3)`, [id, t.id, ctx.userId]);
      const mail = await issueToken(c, this.cfg, (await loadUser(c, id))!, 'invitation');
      await audit(c, ctx, { tenantId: t.id, action: 'tenant.create', objectType: 'tenant', objectId: t.id, after: { name: t.name, code: t.code, admin_email: b.admin_email } });
      return { out: { id: t.id, name: t.name, code: t.code, created_at: t.created_at.toISOString() }, mail };
    });
    deliver(this.mailer, mail);
    return out;
  }
}
