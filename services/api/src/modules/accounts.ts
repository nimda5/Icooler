// Общее для входа и учётных записей: профиль, сессии, одноразовые токены, приглашения.
import type pg from 'pg';
import type { Config } from '../config.ts';
import type { Scope } from '../db/db.service.ts';
import type { Mail, Mailer } from '../mail.ts';
import { csrfFor, newToken, sha256 } from '../auth/crypto.ts';
import { Problem } from '../http/problem.ts';

export interface UserRow {
  id: string; tenant_id: string | null; email: string; name: string; language: string; role: string; status: string;
  last_login_at: Date | null; created_at: Date; cursor_ts?: string;
}

/** Время для курсора — из БД с микросекундами: Date в JS хранит только миллисекунды. */
export const cursorTs = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts`;
export const USER_COLS = `u.id, u.tenant_id, u.email, u.name, u.language, r.role, u.status, u.last_login_at, u.created_at, ${cursorTs('u.created_at')}`;
export const USER_FROM = `app.app_user u join app.role_assignment r on r.user_id = u.id`;

export const scopeOf = (tenantId: string | null): Scope => (tenantId ? { tenantId } : { tenantId: null, global: true });
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const profile = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name, language: u.language, role: u.role, tenant_id: u.tenant_id });
export const userOut = (u: UserRow) => ({
  id: u.id, email: u.email, name: u.name, language: u.language, role: u.role, status: u.status,
  last_login_at: iso(u.last_login_at), created_at: iso(u.created_at),
});

export async function loadUser(c: pg.PoolClient, id: string): Promise<UserRow | undefined> {
  return (await c.query(`select ${USER_COLS} from ${USER_FROM} where u.id = $1 and u.deleted_at is null`, [id])).rows[0];
}

/** Новая сессия: в cookie — токен, в БД — его sha256; CSRF — HMAC от хеша. */
export async function createSession(c: pg.PoolClient, cfg: Config, u: UserRow, remember: boolean, ip: string, ua: string | undefined) {
  const token = newToken();
  const hash = sha256(token);
  const ms = u.role === 'end_user' && remember ? cfg.endUserSessionDays * 864e5 : cfg.operatorSessionH * 36e5;
  const expires = new Date(Date.now() + ms);
  await c.query(`insert into app.auth_session (id_hash, tenant_id, user_id, expires_at, ip, user_agent) values ($1, $2, $3, $4, $5, $6)`,
    [hash, u.tenant_id, u.id, expires, ip, ua ?? null]);
  return { token, expires, body: { user: profile(u), csrf_token: csrfFor(cfg.csrfSecret, hash), expires_at: expires.toISOString() } };
}

export async function revokeSessions(c: pg.PoolClient, userId: string, exceptHash: string | null = null): Promise<void> {
  await c.query(`update app.auth_session set revoked_at = now() where user_id = $1 and revoked_at is null and ($2::text is null or id_hash <> $2)`,
    [userId, exceptHash]);
}

/**
 * Одноразовый токен (приглашение, сброс пароля). Возвращает письмо — отправлять после коммита (deliver):
 * иначе откат транзакции оставит у получателя нерабочую ссылку.
 */
export async function issueToken(c: pg.PoolClient, cfg: Config, u: Pick<UserRow, 'id' | 'tenant_id' | 'email' | 'language'>,
  kind: 'invitation' | 'password_reset'): Promise<Mail> {
  const token = newToken();
  const hours = kind === 'invitation' ? cfg.invitationH : cfg.passwordResetH;
  await c.query(`insert into app.auth_token (token_hash, tenant_id, kind, user_id, expires_at) values ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
    [sha256(token), u.tenant_id, kind, u.id, hours]);
  const path = kind === 'invitation' ? 'invite' : 'reset-password';
  return { to: u.email, kind, language: u.language, link: `${cfg.publicUrl}/${path}?token=${token}` };
}

/** Отправка после коммита: ошибка доставки — в журнал, на ответ не влияет (повтор — новым приглашением/запросом). */
export function deliver(mailer: Mailer, m: Mail): void {
  mailer.send(m).catch((e: unknown) => console.error(`[mail] ${m.kind}: ${(e as Error).message}`));
}

/** Пароль сменился — прочие ссылки сброса пароля больше не действуют. */
export async function invalidateResetTokens(c: pg.PoolClient, userId: string): Promise<void> {
  await c.query(`update app.auth_token set used_at = now() where user_id = $1 and kind = 'password_reset' and used_at is null`, [userId]);
}

/** Строка пользователя под блокировкой: вход, сброс пароля, приглашение и блокировка оператором — по очереди. */
export async function lockUser(c: pg.PoolClient, id: string) {
  // NO KEY UPDATE: такие решения идут по очереди, а вставки, ссылающиеся на пользователя (аудит, настройки,
  // сессии), не ждут его и не дают взаимных блокировок.
  return (await c.query(`select id, status, password_hash, locked_until, deleted_at from app.app_user where id = $1 for no key update`, [id])).rows[0] as
    { id: string; status: string; password_hash: string | null; locked_until: Date | null; deleted_at: Date | null } | undefined;
}

/** Курсор страницы: (время, id) по убыванию; время — cursor_ts из БД. */
export const encodeCursor = (r: { cursor_ts?: string; id: string }) =>
  Buffer.from(JSON.stringify([r.cursor_ts, r.id])).toString('base64url');
/** Курсор из запроса; неверный — 422 (а не тихо первая страница). */
export function decodeCursor(s: string | undefined): [string, string] | null {
  if (!s) return null;
  try {
    const v = JSON.parse(Buffer.from(s, 'base64url').toString()) as unknown;
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string'
      && exactTs(v[0]) && UUID.test(v[1])) return [v[0], v[1]];
  } catch { /* ниже */ }
  throw new Problem(422, 'Неверный курсор', { errors: [{ path: '/cursor', message: 'неверный курсор' }] });
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Время курсора: ровно формат cursor_ts и существующая дата (Date.parse принимает 30 февраля, сдвигая в март);
 * год 0000 PostgreSQL не принимает — только 0001…9999.
 */
function exactTs(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(s) || s.startsWith('0000')) return false;
  const ms = Date.parse(s);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 23) === s.slice(0, 23);
}
