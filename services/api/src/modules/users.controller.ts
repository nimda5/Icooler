// Пользователи оператора (V-003, Admin) и учётные записи End User (§7.5, Admin и Dispatcher). Объекты другого
// арендатора не видны по RLS — для них 404, как и для учётных записей другого вида (оператор ↔ End User).
import { Body, Controller, Inject, Param, Query } from '@nestjs/common';
import type pg from 'pg';
import { Ctx, Op } from '../http/op.ts';
import { conflict, notFound } from '../http/problem.ts';
import { Db } from '../db/db.service.ts';
import { CONFIG, MAILER } from '../tokens.ts';
import type { Config } from '../config.ts';
import type { Mailer } from '../mail.ts';
import type { RequestContext } from '../auth/context.ts';
import { audit } from '../audit.ts';
import { decodeCursor, deliver, encodeCursor, issueToken, loadUser, lockUser, revokeSessions, USER_COLS, USER_FROM, UUID, userOut, type UserRow } from './accounts.ts';

type Kind = 'operator' | 'end_user';
const OPERATOR_ROLES = `('admin', 'tech', 'exec', 'dispatcher')`;
const kindSql = (k: Kind) => (k === 'operator' ? `r.role in ${OPERATOR_ROLES}` : `r.role = 'end_user'`);

@Controller()
export class UsersController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  // ---------------------------------------------------------------- общее

  /** forUpdate — под блокировкой строки: снимок «до» в аудите — то состояние, которое меняется. */
  async #get(c: pg.PoolClient, id: string, kind: Kind, forUpdate = false): Promise<UserRow> {
    if (!UUID.test(id)) throw notFound();
    if (forUpdate) await lockUser(c, id);
    const u = (await c.query(`select ${USER_COLS} from ${USER_FROM} where u.id = $1 and u.deleted_at is null and ${kindSql(kind)}`, [id])).rows[0];
    if (!u) throw notFound();
    return u;
  }

  async #clients(c: pg.PoolClient, ids: string[]) {
    const rows = (await c.query(
      `select a.user_id, a.client_id, cl.name, a.bound_at, a.bound_by from app.end_user_access a
       join app.client cl on cl.id = a.client_id and cl.deleted_at is null
       where a.user_id = any($1) and a.deleted_at is null order by a.bound_at`, [ids])).rows;
    const by = new Map<string, unknown[]>();
    for (const r of rows) by.set(r.user_id, [...(by.get(r.user_id) ?? []), { client_id: r.client_id, name: r.name, bound_at: r.bound_at.toISOString(), bound_by: r.bound_by }]);
    return by;
  }

  async #out(c: pg.PoolClient, u: UserRow, kind: Kind) {
    if (kind === 'operator') return userOut(u);
    const { role: _r, ...rest } = userOut(u);
    return { ...rest, clients: (await this.#clients(c, [u.id])).get(u.id) ?? [] };
  }

  async #list(ctx: RequestContext, kind: Kind, q: Record<string, string | undefined>) {
    const limit = Number(q['limit'] ?? 50); // границы 1..200 проверены по контракту
    const cur = decodeCursor(q['cursor']);
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const where = [`u.deleted_at is null`, kindSql(kind)];
      const args: unknown[] = [];
      const arg = (v: unknown) => { args.push(v); return `$${args.length}`; };
      if (q['q']) where.push(`(u.email ilike ${arg(`%${q['q']}%`)} or u.name ilike $${args.length})`);
      if (q['status']) where.push(`u.status = ${arg(q['status'])}::app.user_status`);
      if (kind === 'operator' && q['role']) where.push(`r.role = ${arg(q['role'])}::app.role`);
      if (kind === 'end_user' && q['client_id']) {
        where.push(`exists (select 1 from app.end_user_access a where a.user_id = u.id and a.client_id = ${arg(q['client_id'])}::uuid and a.deleted_at is null)`);
      }
      if (cur) where.push(`(u.created_at, u.id) < (${arg(cur[0])}::timestamptz, ${arg(cur[1])}::uuid)`);
      const rows: UserRow[] = (await c.query(
        `select ${USER_COLS} from ${USER_FROM} where ${where.join(' and ')} order by u.created_at desc, u.id desc limit ${limit + 1}`, args)).rows;
      const page = rows.slice(0, limit);
      const clients = kind === 'end_user' ? await this.#clients(c, page.map((u) => u.id)) : null;
      return {
        items: page.map((u) => {
          if (!clients) return userOut(u);
          const { role: _r, ...rest } = userOut(u);
          return { ...rest, clients: clients.get(u.id) ?? [] };
        }),
        next_cursor: rows.length > limit ? encodeCursor(page.at(-1)!) : null,
      };
    });
  }

  async #invite(ctx: RequestContext, kind: Kind, b: { email: string; name: string; role?: string; language?: string; client_id?: string }) {
    const { out, mail } = await this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      if (kind === 'end_user') {
        const cl = (await c.query(`select 1 from app.client where id = $1 and deleted_at is null`, [b.client_id])).rowCount;
        if (!cl) throw notFound('Нет такого клиента');
      }
      const exists = (await c.query(`select * from app.auth_lookup_email($1)`, [b.email])).rowCount;
      if (exists) throw conflict('Учётная запись с таким e-mail уже есть');
      const id = (await c.query(`insert into app.app_user (tenant_id, email, name, language, status) values ($1, $2, $3, $4, 'invited') returning id`,
        [ctx.tenantId, b.email, b.name, b.language ?? 'en'])).rows[0].id;
      await c.query(`insert into app.role_assignment (user_id, tenant_id, role, assigned_by) values ($1, $2, $3, $4)`,
        [id, ctx.tenantId, kind === 'operator' ? b.role : 'end_user', ctx.userId]);
      if (kind === 'end_user') {
        await c.query(`insert into app.end_user_access (tenant_id, user_id, client_id, bound_by) values ($1, $2, $3, $4)`, [ctx.tenantId, id, b.client_id, ctx.userId]);
      }
      const u = (await loadUser(c, id))!;
      const mail = await issueToken(c, this.cfg, u, 'invitation');
      await audit(c, ctx, { tenantId: ctx.tenantId, action: `${kind === 'operator' ? 'user' : 'end_user'}.invite`, objectType: 'user', objectId: id,
        after: { email: u.email, role: u.role, status: u.status, ...(b.client_id ? { client_id: b.client_id } : {}) } });
      return { out: await this.#out(c, u, kind), mail };
    });
    deliver(this.mailer, mail); // после коммита
    return out;
  }

  async #update(ctx: RequestContext, kind: Kind, id: string, b: { name?: string; language?: string; role?: string }) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const before = await this.#get(c, id, kind, true);
      if (b.role && id === ctx.userId) throw conflict('Свою роль изменить нельзя');
      await c.query(`update app.app_user set name = coalesce($2, name), language = coalesce($3::app.language, language) where id = $1`,
        [id, b.name ?? null, b.language ?? null]);
      if (b.role) await c.query(`update app.role_assignment set role = $2, assigned_by = $3, assigned_at = now() where user_id = $1`, [id, b.role, ctx.userId]);
      if (b.role && b.role !== before.role) await revokeSessions(c, id); // права меняются сразу
      const after = await this.#get(c, id, kind);
      await audit(c, ctx, { tenantId: ctx.tenantId, action: `${kind === 'operator' ? 'user' : 'end_user'}.update`, objectType: 'user', objectId: id,
        before: { name: before.name, language: before.language, role: before.role }, after: { name: after.name, language: after.language, role: after.role } });
      return this.#out(c, after, kind);
    });
  }

  async #setStatus(ctx: RequestContext, kind: Kind, id: string, action: 'delete' | 'block' | 'unblock'): Promise<void> {
    await this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const u = await this.#get(c, id, kind, true);
      if (id === ctx.userId) throw conflict('Нельзя применить к своей учётной записи');
      if (action === 'delete') await c.query(`update app.app_user set deleted_at = now() where id = $1`, [id]);
      if (action === 'block') await c.query(`update app.app_user set status = 'blocked' where id = $1`, [id]);
      if (action === 'unblock') {
        if (u.status !== 'blocked') throw conflict('Учётная запись не заблокирована');
        await c.query(`update app.app_user set status = (case when password_hash is null then 'invited' else 'active' end)::app.user_status where id = $1`, [id]);
      }
      if (action !== 'unblock') await revokeSessions(c, id); // сессии завершаются сразу (§7.5)
      const after = (await c.query(`select status, deleted_at from app.app_user where id = $1`, [id])).rows[0];
      await audit(c, ctx, { tenantId: ctx.tenantId, action: `${kind === 'operator' ? 'user' : 'end_user'}.${action}`, objectType: 'user', objectId: id,
        before: { status: u.status, deleted_at: null }, after: { status: after.status, deleted_at: after.deleted_at?.toISOString() ?? null } });
    });
  }

  // ---------------------------------------------------------------- пользователи оператора

  @Op('listUsers', 200) listUsers(@Ctx() ctx: RequestContext, @Query() q: Record<string, string>) { return this.#list(ctx, 'operator', q); }
  @Op('inviteUser', 201) inviteUser(@Ctx() ctx: RequestContext, @Body() b: { email: string; name: string; role: string; language?: string }) { return this.#invite(ctx, 'operator', b); }
  @Op('getUser', 200) getUser(@Ctx() ctx: RequestContext, @Param('userId') id: string) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => this.#out(c, await this.#get(c, id, 'operator'), 'operator'));
  }
  @Op('updateUser', 200) updateUser(@Ctx() ctx: RequestContext, @Param('userId') id: string, @Body() b: { name?: string; language?: string; role?: string }) { return this.#update(ctx, 'operator', id, b); }
  @Op('deleteUser', 204) deleteUser(@Ctx() ctx: RequestContext, @Param('userId') id: string) { return this.#setStatus(ctx, 'operator', id, 'delete'); }
  @Op('blockUser', 204) blockUser(@Ctx() ctx: RequestContext, @Param('userId') id: string) { return this.#setStatus(ctx, 'operator', id, 'block'); }
  @Op('unblockUser', 204) unblockUser(@Ctx() ctx: RequestContext, @Param('userId') id: string) { return this.#setStatus(ctx, 'operator', id, 'unblock'); }

  // ---------------------------------------------------------------- End User

  @Op('listEndUsers', 200) listEndUsers(@Ctx() ctx: RequestContext, @Query() q: Record<string, string>) { return this.#list(ctx, 'end_user', q); }
  @Op('inviteEndUser', 201) inviteEndUser(@Ctx() ctx: RequestContext, @Body() b: { email: string; name: string; client_id: string; language?: string }) { return this.#invite(ctx, 'end_user', b); }
  @Op('getEndUser', 200) getEndUser(@Ctx() ctx: RequestContext, @Param('userId') id: string) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => this.#out(c, await this.#get(c, id, 'end_user'), 'end_user'));
  }
  @Op('updateEndUser', 200) updateEndUser(@Ctx() ctx: RequestContext, @Param('userId') id: string, @Body() b: { name?: string; language?: string }) { return this.#update(ctx, 'end_user', id, b); }
  @Op('deleteEndUser', 204) deleteEndUser(@Ctx() ctx: RequestContext, @Param('userId') id: string) { return this.#setStatus(ctx, 'end_user', id, 'delete'); }
  @Op('blockEndUser', 204) blockEndUser(@Ctx() ctx: RequestContext, @Param('userId') id: string) { return this.#setStatus(ctx, 'end_user', id, 'block'); }
  @Op('unblockEndUser', 204) unblockEndUser(@Ctx() ctx: RequestContext, @Param('userId') id: string) { return this.#setStatus(ctx, 'end_user', id, 'unblock'); }

  @Op('bindEndUserClient', 204)
  async bind(@Ctx() ctx: RequestContext, @Param('userId') id: string, @Param('clientId') clientId: string): Promise<void> {
    await this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      await this.#get(c, id, 'end_user', true);
      if (!UUID.test(clientId) || !(await c.query(`select 1 from app.client where id = $1 and deleted_at is null`, [clientId])).rowCount) throw notFound('Нет такого клиента');
      const r = await c.query(`insert into app.end_user_access (tenant_id, user_id, client_id, bound_by) values ($1, $2, $3, $4)
        on conflict (user_id, client_id) where deleted_at is null do nothing`, [ctx.tenantId, id, clientId, ctx.userId]);
      if (r.rowCount) await audit(c, ctx, { tenantId: ctx.tenantId, action: 'end_user.bind_client', objectType: 'user', objectId: id, after: { client_id: clientId } });
    });
  }

  @Op('unbindEndUserClient', 204)
  async unbind(@Ctx() ctx: RequestContext, @Param('userId') id: string, @Param('clientId') clientId: string): Promise<void> {
    await this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      await this.#get(c, id, 'end_user', true);
      const r = UUID.test(clientId)
        ? await c.query(`update app.end_user_access set deleted_at = now() where user_id = $1 and client_id = $2 and deleted_at is null`, [id, clientId])
        : { rowCount: 0 };
      if (!r.rowCount) throw notFound('Не привязан к этому клиенту');
      await revokeSessions(c, id); // доступ к кулерам клиента пропадает сразу
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'end_user.unbind_client', objectType: 'user', objectId: id, before: { client_id: clientId } });
    });
  }
}
