// Вход, сессии, восстановление пароля, приглашения, свой профиль (V-002, §7.1 «Свой профиль», §7.4, §7.5).
// Всё, что меняет учётную запись (вход, сброс, приглашение, смена пароля, блокировка оператором), идёт под
// блокировкой строки пользователя: состояние, по которому принято решение, не меняется до коммита.
import { Body, Controller, Inject, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { Ctx, Op } from '../http/op.ts';
import { Problem, unauthorized } from '../http/problem.ts';
import { RateLimiter } from '../http/rate-limit.ts';
import { SESSION_COOKIE } from '../http/guard.ts';
import { Db } from '../db/db.service.ts';
import { CONFIG, MAILER } from '../tokens.ts';
import type { Config } from '../config.ts';
import type { Mailer } from '../mail.ts';
import type { RequestContext } from '../auth/context.ts';
import { hashPassword, sha256, verifyPassword } from '../auth/crypto.ts';
import { audit } from '../audit.ts';
import {
  createSession, deliver, invalidateResetTokens, issueToken, loadUser, lockUser, profile, revokeSessions, scopeOf, type UserRow,
} from './accounts.ts';

type Reply = FastifyReply & { setCookie(n: string, v: string, o: object): FastifyReply; clearCookie(n: string, o: object): FastifyReply };
const gone = () => new Problem(410, 'Ссылка недействительна или истекла');

@Controller()
export class AuthController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  #cookie(reply: Reply, token: string, expires: Date): void {
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: this.cfg.cookieSecure, sameSite: 'strict', path: '/', expires });
  }

  async #lookupEmail(email: string) {
    return this.db.tx({ tenantId: null }, async (c) =>
      (await c.query('select user_id, tenant_id, status from app.auth_lookup_email($1)', [email])).rows[0] as
        { user_id: string; tenant_id: string | null; status: string } | undefined);
  }

  @Op('login', 200)
  async login(@Body() b: { email: string; password: string; remember_me?: boolean }, @Ctx() ctx: RequestContext,
    @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: Reply) {
    const found = await this.#lookupEmail(b.email);
    if (!found) {
      await verifyPassword(b.password, null); // то же время, что у существующей учётной записи
      throw unauthorized('Неверный e-mail или пароль');
    }
    // Неудача тоже фиксируется (счётчик, блокировка, аудит): транзакция коммитится, ошибка — после неё.
    const r = await this.db.tx(scopeOf(found.tenant_id), async (c) => {
      const who = { userId: null, ip: ctx.ip };
      const u = await lockUser(c, found.user_id);
      const ok = await verifyPassword(b.password, u?.password_hash ?? null); // хеш — тот, что под блокировкой
      if (!u || u.deleted_at) return { fail: unauthorized('Неверный e-mail или пароль') };
      if (u.locked_until && u.locked_until > new Date()) {
        await audit(c, who, { tenantId: found.tenant_id, action: 'auth.login_locked', objectType: 'user', objectId: u.id });
        return { fail: new Problem(423, 'Вход временно заблокирован') };
      }
      if (!ok || u.status !== 'active') {
        await c.query(
          `update app.app_user set
             locked_until = case when failed_logins + 1 >= $2 then now() + make_interval(mins => $3) else null end,
             failed_logins = case when failed_logins + 1 >= $2 then 0 else failed_logins + 1 end
           where id = $1`, [u.id, this.cfg.loginMaxFailures, this.cfg.loginLockoutMin]);
        await audit(c, who, { tenantId: found.tenant_id, action: 'auth.login_failed', objectType: 'user', objectId: u.id });
        return { fail: unauthorized('Неверный e-mail или пароль') };
      }
      await c.query(`update app.app_user set failed_logins = 0, locked_until = null, last_login_at = now() where id = $1`, [u.id]);
      const user = (await loadUser(c, u.id))!;
      const s = await createSession(c, this.cfg, user, !!b.remember_me, ctx.ip, req.headers['user-agent']);
      await audit(c, { userId: user.id, ip: ctx.ip }, { tenantId: user.tenant_id, action: 'auth.login', objectType: 'user', objectId: user.id });
      return { s };
    });
    if ('fail' in r) throw r.fail;
    this.#cookie(reply, r.s.token, r.s.expires);
    return r.s.body;
  }

  @Op('logout', 204)
  async logout(@Ctx() ctx: RequestContext, @Res({ passthrough: true }) reply: Reply): Promise<void> {
    await this.db.tx(scopeOf(ctx.tenantId), async (c) => {
      await c.query(`update app.auth_session set revoked_at = now() where id_hash = $1`, [ctx.sessionHash]);
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'auth.logout', objectType: 'user', objectId: ctx.userId });
    });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Op('logoutAll', 204)
  async logoutAll(@Ctx() ctx: RequestContext, @Res({ passthrough: true }) reply: Reply): Promise<void> {
    await this.db.tx(scopeOf(ctx.tenantId), async (c) => {
      await revokeSessions(c, ctx.userId!);
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'auth.logout_all', objectType: 'user', objectId: ctx.userId });
    });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /**
   * Ответ одинаковый и сразу — есть учётная запись или нет: токен и письмо делаются в фоне после ответа,
   * поэтому ни время, ни ошибка почтовой службы не выдают адрес.
   */
  @Op('forgotPassword', 202)
  async forgot(@Body() b: { email: string }, @Ctx() ctx: RequestContext): Promise<void> {
    this.limiter.hit([{ key: `forgot-email:${b.email.toLowerCase()}`, max: 3, windowS: 3600 }]);
    setImmediate(() => { this.#sendReset(b.email, ctx.ip).catch((e: unknown) => console.error(`[forgot] ${(e as Error).message}`)); });
  }

  /**
   * Активному — ссылка сброса; приглашённому, который ещё не задал пароль, — новое приглашение (письмо с первым
   * могло потеряться: иначе такую учётную запись, в том числе первого Admin нового арендатора, не восстановить).
   */
  async #sendReset(email: string, ip: string): Promise<void> {
    const found = await this.#lookupEmail(email);
    if (!found || (found.status !== 'active' && found.status !== 'invited')) return;
    const mail = await this.db.tx(scopeOf(found.tenant_id), async (c) => {
      const locked = await lockUser(c, found.user_id);
      if (!locked || locked.deleted_at || (locked.status !== 'active' && locked.status !== 'invited')) return null;
      const u = (await loadUser(c, found.user_id))!;
      const kind = locked.status === 'invited' ? 'invitation' : 'password_reset';
      if (kind === 'invitation') {
        await c.query(`update app.auth_token set used_at = now() where user_id = $1 and kind = 'invitation' and used_at is null`, [u.id]);
      }
      const m = await issueToken(c, this.cfg, u, kind);
      await audit(c, { userId: null, ip }, { tenantId: u.tenant_id,
        action: kind === 'invitation' ? 'auth.invitation_reissued' : 'auth.password_reset_requested', objectType: 'user', objectId: u.id });
      return m;
    });
    if (mail) deliver(this.mailer, mail);
  }

  @Op('resetPassword', 204)
  async reset(@Body() b: { token: string; password: string }, @Ctx() ctx: RequestContext): Promise<void> {
    const hash = await hashPassword(b.password); // до блокировки: scrypt не держит строку
    await this.#useToken(b.token, 'password_reset', async (c, u) => {
      await c.query(`update app.app_user set password_hash = $2, failed_logins = 0, locked_until = null where id = $1`, [u.id, hash]);
      await invalidateResetTokens(c, u.id);
      await revokeSessions(c, u.id);
      await audit(c, { userId: null, ip: ctx.ip }, { tenantId: u.tenant_id, action: 'auth.password_reset', objectType: 'user', objectId: u.id });
    });
  }

  @Op('acceptInvitation', 200)
  async accept(@Body() b: { token: string; password: string }, @Ctx() ctx: RequestContext,
    @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: Reply) {
    const hash = await hashPassword(b.password);
    const s = await this.#useToken(b.token, 'invitation', async (c, u, status) => {
      if (status !== 'invited') throw gone(); // заблокирован или уже активен — приглашение не действует
      await c.query(`update app.app_user set password_hash = $2, status = 'active', last_login_at = now() where id = $1`, [u.id, hash]);
      await audit(c, { userId: u.id, ip: ctx.ip }, { tenantId: u.tenant_id, action: 'auth.invitation_accepted', objectType: 'user', objectId: u.id,
        before: { status }, after: { status: 'active' } });
      return createSession(c, this.cfg, { ...u, status: 'active' }, false, ctx.ip, req.headers['user-agent']);
    });
    this.#cookie(reply, s.token, s.expires);
    return s.body;
  }

  /** Токен: найти до выбора арендатора, затем под блокировкой пользователя погасить и выполнить действие. */
  async #useToken<T>(token: string, kind: string, fn: (c: pg.PoolClient, u: UserRow, status: string) => Promise<T>): Promise<T> {
    const hash = sha256(token);
    const t = await this.db.tx({ tenantId: null }, async (c) =>
      (await c.query('select * from app.auth_lookup_token($1)', [hash])).rows[0] as { user_id: string; tenant_id: string | null; kind: string } | undefined);
    if (!t || t.kind !== kind) throw gone();
    return this.db.tx(scopeOf(t.tenant_id), async (c) => {
      const locked = await lockUser(c, t.user_id);
      if (!locked || locked.deleted_at) throw gone();
      // После блокировки: другой сброс мог уже погасить этот токен (invalidateResetTokens) — тогда 410.
      const used = await c.query(`update app.auth_token set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning 1`, [hash]);
      if (!used.rowCount) throw gone();
      const u = (await loadUser(c, t.user_id))!;
      return fn(c, u, locked.status);
    });
  }

  @Op('getProfile', 200)
  async me(@Ctx() ctx: RequestContext) {
    return this.db.tx(scopeOf(ctx.tenantId), async (c) => profile((await loadUser(c, ctx.userId!))!));
  }

  @Op('updateProfile', 200)
  async updateMe(@Body() b: { name?: string; language?: string }, @Ctx() ctx: RequestContext) {
    return this.db.tx(scopeOf(ctx.tenantId), async (c) => {
      await lockUser(c, ctx.userId!);
      const before = (await loadUser(c, ctx.userId!))!;
      await c.query(`update app.app_user set name = coalesce($2, name), language = coalesce($3::app.language, language) where id = $1`,
        [ctx.userId, b.name ?? null, b.language ?? null]);
      const after = (await loadUser(c, ctx.userId!))!;
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'user.update_profile', objectType: 'user', objectId: ctx.userId,
        before: { name: before.name, language: before.language }, after: { name: after.name, language: after.language } });
      return profile(after);
    });
  }

  @Op('changePassword', 204)
  async changePassword(@Body() b: { current_password: string; new_password: string }, @Ctx() ctx: RequestContext): Promise<void> {
    const hash = await hashPassword(b.new_password);
    const fail = await this.db.tx(scopeOf(ctx.tenantId), async (c) => {
      const u = await lockUser(c, ctx.userId!);
      if (!(await verifyPassword(b.current_password, u?.password_hash ?? null))) return true;
      await c.query(`update app.app_user set password_hash = $2 where id = $1`, [ctx.userId, hash]);
      await invalidateResetTokens(c, ctx.userId!);
      await revokeSessions(c, ctx.userId!, ctx.sessionHash);
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'user.change_password', objectType: 'user', objectId: ctx.userId });
      return false;
    });
    if (fail) throw new Problem(422, 'Текущий пароль неверен', { errors: [{ path: '/current_password', message: 'неверен' }] });
  }
}
