// Сквозные тесты API на PostgreSQL: вход и сессии (V-002, §7.4), права по x-roles (§7.1), изоляция арендаторов
// (P-07), пользователи и End User (V-003, §7.5), арендаторы (SIG Administrator), аудит (V-005).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { migrateDb } from '../src/db/migrate.ts';
import { createApp, CONTROLLERS } from '../src/app.ts';
import { MemoryMailer } from '../src/mail.ts';
import { RateLimiter } from '../src/http/rate-limit.ts';
import { hashPassword, sha256 } from '../src/auth/crypto.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../src/paths.ts';
import { operations } from '../src/openapi/spec.ts';
import { OP_KEY } from '../src/http/op.ts';
import type { Config } from '../src/config.ts';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL не задан — см. services/api/README.md');
const dbName = `icooler_api_${process.pid}_${Date.now()}`;
const url = new URL(ADMIN_URL);
url.pathname = `/${dbName}`;

const T_A = '11111111-1111-4111-8111-111111111111';
const T_B = '22222222-2222-4222-8222-222222222222';
const C_A = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const C_B = 'bbbbbbbb-0000-4000-8000-0000000000c1';
const PW = 'correct horse battery';
const D_A = 'aaaaaaaa-0000-4000-8000-0000000000d1';
const D_B = 'bbbbbbbb-0000-4000-8000-0000000000d1';
const ROLES = ['admin', 'tech', 'exec', 'dispatcher', 'end_user', 'sig_admin'] as const;
type Role = (typeof ROLES)[number];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USERS: Record<Role, { id: string; email: string; tenant: string | null }> = {
  admin: { id: id(1), email: 'admin@a.example', tenant: T_A },
  tech: { id: id(2), email: 'tech@a.example', tenant: T_A },
  exec: { id: id(3), email: 'exec@a.example', tenant: T_A },
  dispatcher: { id: id(4), email: 'disp@a.example', tenant: T_A },
  end_user: { id: id(5), email: 'eu@a.example', tenant: T_A },
  sig_admin: { id: id(6), email: 'sig@sig.example', tenant: null },
};
const ADMIN_B = { id: id(11), email: 'admin@b.example' };

let app: NestFastifyApplication;
let pool: pg.Pool;
const mailer = new MemoryMailer();
let ipSeq = 1;
const freshIp = () => `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

interface Sess { cookie: string; csrf: string; ip: string }
interface Res { status: number; body: any; headers: Record<string, unknown> }

// Операция контракта по методу и пути — чтобы проверить тело каждого успешного ответа по схеме OpenAPI.
const ROUTES = [...operations().values()].map((o) => ({ o, re: new RegExp(`^${o.path.replace(/\{\w+\}/g, '[^/]+')}$`) }));
const opFor = (method: string, path: string) => ROUTES.find((r) => r.o.method === method && r.re.test(path.split('?')[0]!))?.o;
const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('не дождались'); await new Promise((r) => setTimeout(r, 10)); }
};

async function call(method: string, path: string, opts: { sess?: Sess; body?: unknown; csrf?: string | null; ip?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.sess) headers['cookie'] = opts.sess.cookie;
  const csrf = opts.csrf === undefined ? opts.sess?.csrf : opts.csrf;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (opts.headers) Object.assign(headers, opts.headers);
  const r = await app.inject({ method: method as 'GET', url: `/api/v1${path}`, headers, remoteAddress: opts.ip ?? opts.sess?.ip ?? '10.255.0.1',
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });
  const res = { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, headers: r.headers };
  const op = opFor(method, path);
  assert.ok(op, `нет операции контракта для ${method} ${path}`);
  if (res.status >= 200 && res.status < 300) {
    const v = op.responses.get(String(res.status));
    if (v) assert.ok(v(res.body), `${op.id} ${res.status}: ответ не по схеме контракта ${JSON.stringify(v.errors)} ${JSON.stringify(res.body)}`);
    else assert.ok(res.body === null, `${op.id} ${res.status}: тело там, где контракт его не описывает`);
  } else if (res.status !== 404 || res.body?.status === 404) {
    assert.equal(r.headers['content-type'], 'application/problem+json; charset=utf-8', `${op.id}: ошибка не problem+json`);
  }
  return res;
}

async function login(email: string, password = PW, ip = freshIp(), extra: object = {}): Promise<Sess> {
  const r = await call('POST', '/auth/login', { body: { email, password, ...extra }, ip });
  assert.equal(r.status, 200, `вход ${email}: ${JSON.stringify(r.body)}`);
  const sc = String(r.headers['set-cookie']);
  return { cookie: sc.split(';')[0]!, csrf: r.body.csrf_token, ip };
}

const sess = {} as Record<Role, Sess>;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  await migrateDb(url.toString());
  pool = new pg.Pool({ connectionString: url.toString() });
  const hash = await hashPassword(PW);
  await pool.query(`insert into app.tenant (id, name, code) values ($1, 'VENDEN', 'venden'), ($2, 'Other', 'other')`, [T_A, T_B]);
  await pool.query(`insert into app.client (id, tenant_id, type, name) values ($1, $3, 'organization', 'A1'), ($2, $4, 'organization', 'B1')`, [C_A, C_B, T_A, T_B]);
  for (const [role, u] of [...Object.entries(USERS), ['admin', { ...ADMIN_B, tenant: T_B }] as const]) {
    await pool.query(`insert into app.app_user (id, tenant_id, email, name, status, password_hash) values ($1, $2, $3, $4, 'active', $5)`,
      [u.id, u.tenant, u.email, `${role} user`, hash]);
    await pool.query(`insert into app.role_assignment (user_id, tenant_id, role) values ($1, $2, $3)`, [u.id, u.tenant, role]);
  }
  await pool.query(`insert into app.end_user_access (tenant_id, user_id, client_id, bound_by) values ($1, $2, $3, $4)`, [T_A, USERS.end_user.id, C_A, USERS.admin.id]);
  await pool.query(`insert into app.device (id, tenant_id, device_id, serial, water_source, variant, carbonated) values
    ($1, $3, 'cooler-a1', 'SN-A1', 'mains', 'A', false), ($2, $4, 'cooler-b1', 'SN-B1', 'mains', 'A', false)`, [D_A, D_B, T_A, T_B]);
  const cfg: Config = {
    databaseUrl: url.toString(), dbRole: 'app_api', csrfSecret: 'test-secret-0123456789', cookieSecure: true, trustProxyHops: 0,
    publicUrl: 'https://portal.example', operatorSessionH: 12, endUserSessionDays: 30, invitationH: 72, passwordResetH: 1,
    loginMaxFailures: 5, loginLockoutMin: 15,
  };
  app = await createApp(cfg, mailer, new RateLimiter());
  for (const r of ROLES) sess[r] = await login(USERS[r].email);
});

after(async () => {
  await app?.close();
  await pool?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

const auditCount = async (action: string, objectId?: string) =>
  (await pool.query(`select count(*)::int as n from app.audit_log where action = $1 and ($2::text is null or object_id = $2)`, [action, objectId ?? null])).rows[0].n as number;

// ---------------------------------------------------------------- вход и сессии

test('вход: cookie HttpOnly/Secure/SameSite=Strict, профиль; неверный пароль и неизвестный e-mail — одинаковый 401', async () => {
  const r = await call('POST', '/auth/login', { body: { email: 'TECH@a.example', password: PW }, ip: freshIp() });
  assert.equal(r.status, 200);
  assert.match(String(r.headers['set-cookie']), /^session=[A-Za-z0-9_-]{43};.*HttpOnly.*Secure.*SameSite=Strict/i);
  assert.equal(r.body.user.role, 'tech');
  assert.ok(r.body.csrf_token);
  const me = await call('GET', '/me', { sess: sess.tech });
  assert.deepEqual([me.status, me.body.email, me.body.role], [200, 'tech@a.example', 'tech']);
  const bad = await call('POST', '/auth/login', { body: { email: 'tech@a.example', password: 'wrong password' }, ip: freshIp() });
  const none = await call('POST', '/auth/login', { body: { email: 'nobody@a.example', password: 'wrong password' }, ip: freshIp() });
  assert.deepEqual([bad.status, none.status], [401, 401]);
  assert.equal(bad.body.detail, none.body.detail);
  assert.equal(bad.headers['content-type'], 'application/problem+json; charset=utf-8');
});

test('5 неудачных входов подряд — блокировка входа на 15 мин (423), даже с верным паролем; всё в аудите', async () => {
  const email = 'exec@a.example';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { body: { email, password: 'nope nope nope' }, ip: freshIp() })).status, 401);
  const r = await call('POST', '/auth/login', { body: { email, password: PW }, ip: freshIp() });
  assert.equal(r.status, 423);
  assert.equal(await auditCount('auth.login_failed', USERS.exec.id), 5);
  assert.equal(await auditCount('auth.login_locked', USERS.exec.id), 1);
  const until = (await pool.query(`select locked_until from app.app_user where id = $1`, [USERS.exec.id])).rows[0].locked_until as Date;
  assert.ok(until.getTime() - Date.now() > 14 * 60_000);
  await pool.query(`update app.app_user set locked_until = null where id = $1`, [USERS.exec.id]);
});

test('лимит входа — 10 в минуту с IP: 11-я попытка — 429 с Retry-After', async () => {
  const ip = freshIp();
  for (let i = 0; i < 10; i++) await call('POST', '/auth/login', { body: { email: 'x@a.example', password: 'whatever pw' }, ip });
  const r = await call('POST', '/auth/login', { body: { email: 'x@a.example', password: 'whatever pw' }, ip });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers['retry-after']) > 0);
});

test('без сессии — 401; изменяющий запрос без X-CSRF-Token или с чужим — 403; тело не по схеме — 422', async () => {
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('PATCH', '/me', { sess: sess.tech, body: { name: 'T' }, csrf: null })).status, 403);
  assert.equal((await call('PATCH', '/me', { sess: sess.tech, body: { name: 'T' }, csrf: sess.admin.csrf })).status, 403);
  const v = await call('PATCH', '/me', { sess: sess.tech, body: {} });
  assert.equal(v.status, 422);
  assert.ok(Array.isArray(v.body.errors));
  const ok = await call('PATCH', '/me', { sess: sess.tech, body: { language: 'lv' } });
  assert.deepEqual([ok.status, ok.body.language], [200, 'lv']);
});

test('выход со всех устройств: обе сессии больше не действуют', async () => {
  const s1 = await login('disp@a.example'), s2 = await login('disp@a.example');
  assert.equal((await call('POST', '/auth/logout-all', { sess: s1 })).status, 204);
  assert.equal((await call('GET', '/me', { sess: s1 })).status, 401);
  assert.equal((await call('GET', '/me', { sess: s2 })).status, 401);
  sess.dispatcher = await login('disp@a.example');
});

test('восстановление пароля: ответ одинаковый; новый пароль, токен одноразовый, прежние сессии завершены', async () => {
  const n0 = mailer.sent.length;
  assert.equal((await call('POST', '/auth/password/forgot', { body: { email: 'nobody@a.example' }, ip: freshIp() })).status, 202);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(mailer.sent.length, n0);
  const old = await login('tech@a.example');
  assert.equal((await call('POST', '/auth/password/forgot', { body: { email: 'tech@a.example' }, ip: freshIp() })).status, 202);
  await until(() => mailer.sent.length > n0);
  const m = mailer.sent.at(-1)!;
  assert.equal(m.kind, 'password_reset');
  const token = new URL(m.link).searchParams.get('token')!;
  const np = 'new tech password 2026';
  assert.equal((await call('POST', '/auth/password/reset', { body: { token, password: np } })).status, 204);
  assert.equal((await call('POST', '/auth/password/reset', { body: { token, password: np } })).status, 410);
  assert.equal((await call('GET', '/me', { sess: old })).status, 401);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'tech@a.example', password: PW }, ip: freshIp() })).status, 401);
  sess.tech = await login('tech@a.example', np);
});

test('ссылка одноразовая и при одновременных запросах: из двух — один 204, другой 410', async () => {
  const n0 = mailer.sent.length;
  await call('POST', '/auth/password/forgot', { body: { email: 'exec@a.example' }, ip: freshIp() });
  await until(() => mailer.sent.length > n0);
  const token = new URL(mailer.sent.at(-1)!.link).searchParams.get('token')!;
  const rs = await Promise.all([1, 2].map(() => call('POST', '/auth/password/reset', { body: { token, password: 'exec new password 1' } })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [204, 410]);
  await pool.query(`update app.app_user set password_hash = (select password_hash from app.app_user where id = $2) where id = $1`, [USERS.exec.id, USERS.admin.id]);
  sess.exec = await login('exec@a.example');
});

test('лимит восстановления пароля — 3 в час на e-mail', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/auth/password/forgot', { body: { email: 'limit@a.example' }, ip: freshIp() })).status, 202);
  assert.equal((await call('POST', '/auth/password/forgot', { body: { email: 'limit@a.example' }, ip: freshIp() })).status, 429);
});

// ---------------------------------------------------------------- права по матрице 7.1

// Ожидаемые права — из матрицы §7.1 (contracts/openapi/roles-matrix.json), а не из проверяемого x-roles.
const MATRIX = JSON.parse(readFileSync(join(repoRoot(), 'contracts/openapi/roles-matrix.json'), 'utf8')) as {
  rows: { action: string; cells?: Record<string, string>; view?: string[]; change?: string[]; any?: string[]; public?: string[]; eu_operations?: string[] }[];
};
function expectedRoles(opId: string): Role[] {
  for (const r of MATRIX.rows) {
    if (r.any?.includes(opId)) return [...ROLES];
    if (r.eu_operations?.includes(opId)) return ['end_user'];
    const kind = r.view?.includes(opId) ? 'view' : r.change?.includes(opId) ? 'change' : null;
    if (kind) return ROLES.filter((x) => x !== 'end_user' && (r.cells![x] === '✅' || (kind === 'view' && r.cells![x] === '👁')));
  }
  throw new Error(`${opId}: нет в матрице`);
}

let seq = 0;
async function mkUser(role: Role, status = 'active', client?: string): Promise<string> {
  const uid = id(5000 + ++seq);
  await pool.query(`insert into app.app_user (id, tenant_id, email, name, status, password_hash) values ($1, $2, $3, 'target', $4, (select password_hash from app.app_user where id = $5))`,
    [uid, T_A, `target${seq}@a.example`, status, USERS.admin.id]);
  await pool.query(`insert into app.role_assignment (user_id, tenant_id, role) values ($1, $2, $3)`, [uid, T_A, role]);
  if (client) await pool.query(`insert into app.end_user_access (tenant_id, user_id, client_id, bound_by) values ($1, $2, $3, $4)`, [T_A, uid, client, USERS.admin.id]);
  return uid;
}

// Запросы на реализованные операции: тело проходит схему, у разрешённой роли — успех; меняющие — над свежей целью.
const REQ: Record<string, (role: Role) => Promise<[string, string, unknown?]> | [string, string, unknown?]> = {
  deleteUser: async () => ['DELETE', `/users/${await mkUser('tech')}`],
  blockUser: async () => ['POST', `/users/${await mkUser('tech')}/block`],
  unblockUser: async () => ['DELETE', `/users/${await mkUser('tech', 'blocked')}/block`],
  deleteEndUser: async () => ['DELETE', `/end-users/${await mkUser('end_user', 'active', C_A)}`],
  blockEndUser: async () => ['POST', `/end-users/${await mkUser('end_user', 'active', C_A)}/block`],
  unblockEndUser: async () => ['DELETE', `/end-users/${await mkUser('end_user', 'blocked', C_A)}/block`],
  unbindEndUserClient: async () => ['DELETE', `/end-users/${await mkUser('end_user', 'active', C_A)}/clients/${C_A}`],
  getProfile: () => ['GET', '/me'],
  updateProfile: () => ['PATCH', '/me', { language: 'en' }],
  createTenant: (r) => ['POST', '/tenants', { name: 'X', code: `x-${r.replace('_', '-')}`, admin_email: `x-${r}@x.example`, admin_name: 'X' }],
  listUsers: () => ['GET', '/users'],
  inviteUser: (r) => ['POST', '/users', { email: `matrix-op-${r}@a.example`, name: 'M', role: 'tech' }],
  getUser: () => ['GET', `/users/${USERS.tech.id}`],
  updateUser: () => ['PATCH', `/users/${USERS.exec.id}`, { language: 'en' }],
  listEndUsers: () => ['GET', '/end-users'],
  inviteEndUser: (r) => ['POST', '/end-users', { email: `matrix-eu-${r}@a.example`, name: 'M', client_id: C_A }],
  getEndUser: () => ['GET', `/end-users/${USERS.end_user.id}`],
  updateEndUser: () => ['PATCH', `/end-users/${USERS.end_user.id}`, { language: 'en' }],
  bindEndUserClient: () => ['PUT', `/end-users/${USERS.end_user.id}/clients/${C_A}`],
  listAudit: () => ['GET', '/audit-log'],
  getSettings: () => ['GET', '/settings'],
  updateSettings: () => ['PATCH', '/settings', { upcoming_filters_days: 30 }],
  getDeviceSettings: () => ['GET', `/devices/${D_A}/settings`],
  updateDeviceSettings: () => ['PATCH', `/devices/${D_A}/settings`, { offline_after_min: 3 }],
};

test('права: каждая операция × каждая роль — разрешено 2xx, запрещено 403 (по матрице 7.1, roles-matrix.json)', async () => {
  const ops = operations();
  for (const [opId, req] of Object.entries(REQ)) {
    const op = ops.get(opId)!;
    for (const role of ROLES) {
      const [method, path, body] = await req(role);
      assert.equal(op.method, method, opId);
      const allowed = expectedRoles(opId).includes(role);
      const r = await call(method, path, { sess: sess[role], ...(body !== undefined ? { body } : {}) });
      if (allowed) assert.ok(r.status >= 200 && r.status < 300, `${opId} ${role}: ожидалось 2xx, ${r.status} ${JSON.stringify(r.body)}`);
      else assert.equal(r.status, 403, `${opId} ${role}: ожидалось 403, ${r.status}`);
    }
  }
});

test('каждая операция тегов auth, profile, tenants, users, end-users, настройки и аудит реализована — и только из контракта', () => {
  const handled = new Set<string>();
  for (const C of CONTROLLERS) {
    for (const k of Object.getOwnPropertyNames(C.prototype)) {
      const opId = Reflect.getMetadata(OP_KEY, (C.prototype as unknown as Record<string, unknown>)[k] as object) as string | undefined;
      if (opId) handled.add(opId);
    }
  }
  const all = operations();
  for (const h of handled) assert.ok(all.has(h), `обработчик ${h} — нет в контракте`);
  const want = ['login', 'logout', 'logoutAll', 'forgotPassword', 'resetPassword', 'acceptInvitation', 'getProfile', 'updateProfile',
    'changePassword', 'createTenant', 'listUsers', 'inviteUser', 'getUser', 'updateUser', 'deleteUser', 'blockUser', 'unblockUser',
    'listEndUsers', 'inviteEndUser', 'getEndUser', 'updateEndUser', 'deleteEndUser', 'blockEndUser', 'unblockEndUser',
    'bindEndUserClient', 'unbindEndUserClient', 'listAudit', 'getSettings', 'updateSettings', 'getDeviceSettings', 'updateDeviceSettings',
    'listClients', 'createClient', 'getClient', 'updateClient', 'deleteClient', 'createAddress', 'updateAddress', 'deleteAddress',
    'createContact', 'updateContact', 'deleteContact', 'listDevices', 'createDevice', 'getDevice', 'updateDevice', 'transferDevice',
    'setLifecycle', 'setOwnership', 'getDeviceHistory', 'getMap', 'importDevices', 'exportDevices'];
  assert.deepEqual([...handled].sort(), want.sort());
});

// ---------------------------------------------------------------- изоляция и учётные записи

test('другой арендатор — 404, в списках не виден; оператор и End User — разные пространства', async () => {
  assert.equal((await call('GET', `/users/${ADMIN_B.id}`, { sess: sess.admin })).status, 404);
  const list = await call('GET', '/users?limit=200', { sess: sess.admin });
  assert.equal(list.status, 200);
  assert.ok(!list.body.items.some((u: { id: string }) => u.id === ADMIN_B.id));
  assert.ok(list.body.items.every((u: { role: string }) => u.role !== 'end_user'));
  assert.equal((await call('GET', `/users/${USERS.end_user.id}`, { sess: sess.admin })).status, 404);
  assert.equal((await call('GET', `/end-users/${USERS.tech.id}`, { sess: sess.admin })).status, 404);
  assert.equal((await call('PUT', `/end-users/${USERS.end_user.id}/clients/${C_B}`, { sess: sess.admin })).status, 404);
  assert.equal((await call('POST', '/end-users', { sess: sess.dispatcher, body: { email: 'eu-b@a.example', name: 'X', client_id: C_B } })).status, 404);
  assert.equal((await call('GET', '/users/not-a-uuid', { sess: sess.admin })).status, 404);
});

test('приглашение: письмо, пароль по ссылке, вход; ссылка одноразовая; повторный e-mail — 409', async () => {
  const r = await call('POST', '/users', { sess: sess.admin, body: { email: 'new-tech@a.example', name: 'New', role: 'tech', language: 'ru' } });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.status, r.body.role], ['invited', 'tech']);
  assert.equal((await call('POST', '/users', { sess: sess.admin, body: { email: 'NEW-tech@a.example', name: 'Dup', role: 'tech' } })).status, 409);
  const m = mailer.sent.at(-1)!;
  assert.deepEqual([m.to, m.kind, m.language], ['new-tech@a.example', 'invitation', 'ru']);
  const token = new URL(m.link).searchParams.get('token')!;
  const acc = await call('POST', '/auth/invitations/accept', { body: { token, password: 'new tech pass 123' } });
  assert.equal(acc.status, 200);
  assert.equal(acc.body.user.role, 'tech');
  assert.equal((await call('POST', '/auth/invitations/accept', { body: { token, password: 'new tech pass 123' } })).status, 410);
  await login('new-tech@a.example', 'new tech pass 123');
  assert.equal(await auditCount('user.invite', r.body.id), 1);
  assert.equal(await auditCount('auth.invitation_accepted', r.body.id), 1);
});

test('блокировка: сессии пользователя завершаются сразу; разблокировка — снова можно войти', async () => {
  const s = await login('disp@a.example');
  assert.equal((await call('POST', `/users/${USERS.dispatcher.id}/block`, { sess: sess.admin })).status, 204);
  assert.equal((await call('GET', '/me', { sess: s })).status, 401);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'disp@a.example', password: PW }, ip: freshIp() })).status, 401);
  assert.equal((await call('DELETE', `/users/${USERS.dispatcher.id}/block`, { sess: sess.admin })).status, 204);
  sess.dispatcher = await login('disp@a.example');
  assert.equal(await auditCount('user.block', USERS.dispatcher.id), 1);
});

test('смена роли — права меняются сразу (сессии завершены); свою роль и себя заблокировать нельзя', async () => {
  const s = await login('exec@a.example');
  assert.equal((await call('PATCH', `/users/${USERS.exec.id}`, { sess: sess.admin, body: { role: 'tech' } })).status, 200);
  assert.equal((await call('GET', '/me', { sess: s })).status, 401);
  assert.equal((await call('PATCH', `/users/${USERS.exec.id}`, { sess: sess.admin, body: { role: 'exec' } })).status, 200);
  sess.exec = await login('exec@a.example');
  assert.equal((await call('PATCH', `/users/${USERS.admin.id}`, { sess: sess.admin, body: { role: 'tech' } })).status, 409);
  assert.equal((await call('POST', `/users/${USERS.admin.id}/block`, { sess: sess.admin })).status, 409);
  assert.equal((await call('DELETE', `/users/${USERS.admin.id}`, { sess: sess.admin })).status, 409);
});

test('End User: Dispatcher приглашает к клиенту, список с клиентами; отвязка завершает сессии End User', async () => {
  const r = await call('POST', '/end-users', { sess: sess.dispatcher, body: { email: 'eu2@a.example', name: 'EU2', client_id: C_A } });
  assert.equal(r.status, 201);
  assert.equal(r.body.clients[0].client_id, C_A);
  assert.equal(r.body.role, undefined);
  const list = await call('GET', `/end-users?client_id=${C_A}`, { sess: sess.dispatcher });
  assert.ok(list.body.items.some((u: { id: string }) => u.id === r.body.id));
  const eu = await login('eu@a.example');
  assert.equal((await call('DELETE', `/end-users/${USERS.end_user.id}/clients/${C_A}`, { sess: sess.admin })).status, 204);
  assert.equal((await call('GET', '/me', { sess: eu })).status, 401);
  assert.equal((await call('PUT', `/end-users/${USERS.end_user.id}/clients/${C_A}`, { sess: sess.admin })).status, 204);
  assert.equal((await call('GET', `/end-users/${USERS.end_user.id}`, { sess: sess.admin })).body.clients.length, 1);
  sess.end_user = await login('eu@a.example');
});

test('страницы: limit и курсор без пропусков и повторов — и для строк в одну миллисекунду', async () => {
  // Пять пользователей, время создания которых различается только микросекундами.
  for (let i = 1; i <= 5; i++) {
    const uid = id(900 + i);
    await pool.query(`insert into app.app_user (id, tenant_id, email, name, created_at) values ($1, $2, $3, 'us', $4)`,
      [uid, T_A, `us${i}@a.example`, `2026-01-01T00:00:00.000${i}00Z`]);
    await pool.query(`insert into app.role_assignment (user_id, tenant_id, role) values ($1, $2, 'exec')`, [uid, T_A]);
  }
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const q: string = `/users?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
    const r = await call('GET', q, { sess: sess.admin });
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length <= 2);
    seen.push(...r.body.items.map((u: { id: string }) => u.id));
    cursor = r.body.next_cursor;
  } while (cursor);
  const all = (await call('GET', '/users?limit=200', { sess: sess.admin })).body.items.map((u: { id: string }) => u.id);
  assert.deepEqual(seen, all);
  assert.equal(new Set(seen).size, seen.length);
});

test('SIG Administrator создаёт арендатора с первым Admin (приглашение); код занят — 409; Admin арендатора — 403', async () => {
  const r = await call('POST', '/tenants', { sess: sess.sig_admin, body: { name: 'Third', code: 'third', admin_email: 'first@third.example', admin_name: 'First' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.code, 'third');
  const m = mailer.sent.at(-1)!;
  assert.deepEqual([m.to, m.kind], ['first@third.example', 'invitation']);
  const acc = await call('POST', '/auth/invitations/accept', { body: { token: new URL(m.link).searchParams.get('token'), password: 'third admin pass' } });
  assert.deepEqual([acc.status, acc.body.user.role, acc.body.user.tenant_id], [200, 'admin', r.body.id]);
  assert.equal((await call('POST', '/tenants', { sess: sess.sig_admin, body: { name: 'T', code: 'third', admin_email: 'z@third.example', admin_name: 'Z' } })).status, 409);
  assert.equal((await call('POST', '/tenants', { sess: sess.admin, body: { name: 'T', code: 'fourth', admin_email: 'z@4.example', admin_name: 'Z' } })).status, 403);
  assert.equal(await auditCount('tenant.create', r.body.id), 1);
  // Новый Admin видит только свой арендатор.
  const s = await login('first@third.example', 'third admin pass');
  const users = (await call('GET', '/users', { sess: s })).body.items.map((u: { email: string }) => u.email);
  assert.deepEqual(users, ['first@third.example']);
});

test('смена своего пароля: неверный текущий — 422; прочие сессии завершены, текущая работает', async () => {
  const other = await login('disp@a.example');
  const cur = await login('disp@a.example');
  assert.equal((await call('PUT', '/me/password', { sess: cur, body: { current_password: 'wrong', new_password: 'another long pass' } })).status, 422);
  assert.equal((await call('PUT', '/me/password', { sess: cur, body: { current_password: PW, new_password: 'another long pass' } })).status, 204);
  assert.equal((await call('GET', '/me', { sess: other })).status, 401);
  assert.equal((await call('GET', '/me', { sess: cur })).status, 200);
});

test('X-Forwarded-For не учитывается (TRUST_PROXY_HOPS=0): подставной IP не обходит лимит и не попадает в аудит', async () => {
  const ip = freshIp();
  for (let i = 0; i < 10; i++) {
    await call('POST', '/auth/login', { body: { email: 'xff@a.example', password: 'whatever pw' }, ip, headers: { 'x-forwarded-for': `192.0.2.${i}` } });
  }
  const r = await call('POST', '/auth/login', { body: { email: 'xff@a.example', password: 'whatever pw' }, ip, headers: { 'x-forwarded-for': '192.0.2.99' } });
  assert.equal(r.status, 429);
  await call('POST', '/auth/login', { body: { email: 'tech@a.example', password: 'wrong wrong wrong' }, ip: freshIp(), headers: { 'x-forwarded-for': '203.0.113.7' } });
  const ips = (await pool.query(`select ip from app.audit_log where action = 'auth.login_failed' order by at desc limit 1`)).rows[0].ip;
  assert.notEqual(ips, '203.0.113.7');
});

test('сроки: сессия оператора 12 ч, End User с «запомнить меня» 30 дней, без — 12 ч; приглашение 72 ч', async () => {
  const exp = async (email: string, extra: object = {}) => {
    const r = await call('POST', '/auth/login', { body: { email, password: PW, ...extra }, ip: freshIp() });
    return (Date.parse(r.body.expires_at) - Date.now()) / 36e5;
  };
  const near = (h: number, want: number) => Math.abs(h - want) < 0.1;
  assert.ok(near(await exp('admin@a.example', { remember_me: true }), 12), 'оператор — 12 ч и с «запомнить меня»');
  assert.ok(near(await exp('eu@a.example', { remember_me: true }), 720));
  assert.ok(near(await exp('eu@a.example'), 12));
  const n0 = mailer.sent.length;
  const inv = await call('POST', '/users', { sess: sess.admin, body: { email: 'ttl@a.example', name: 'TTL', role: 'exec' } });
  await until(() => mailer.sent.length > n0);
  const h = (await pool.query(`select extract(epoch from expires_at - created_at) / 3600 as h from app.auth_token where user_id = $1`, [inv.body.id])).rows[0].h;
  assert.ok(near(Number(h), 72));
});

test('две разные ссылки сброса одновременно — пароль меняется один раз; старая ссылка после сброса — 410', async () => {
  const tokens: string[] = [];
  for (let i = 0; i < 2; i++) {
    const n0 = mailer.sent.length;
    await call('POST', '/auth/password/forgot', { body: { email: 'disp@a.example' }, ip: freshIp() });
    await until(() => mailer.sent.length > n0);
    tokens.push(new URL(mailer.sent.at(-1)!.link).searchParams.get('token')!);
  }
  const rs = await Promise.all(tokens.map((token, i) => call('POST', '/auth/password/reset', { body: { token, password: `parallel pass ${i}xx` } })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [204, 410]);
  const winner = rs.findIndex((r) => r.status === 204);
  sess.dispatcher = await login('disp@a.example', `parallel pass ${winner}xx`);
  await pool.query(`update app.app_user set password_hash = (select password_hash from app.app_user where id = $2) where id = $1`, [USERS.dispatcher.id, USERS.admin.id]);
  sess.dispatcher = await login('disp@a.example');
});

test('журнал аудита: Admin и Exec видят свой арендатор с фильтрами; снимки до/после у блокировки', async () => {
  await call('POST', `/users/${USERS.tech.id}/block`, { sess: sess.admin });
  await call('DELETE', `/users/${USERS.tech.id}/block`, { sess: sess.admin });
  sess.tech = await login('tech@a.example', 'new tech password 2026').catch(() => login('tech@a.example'));
  const r = await call('GET', `/audit-log?action=user.block&object_id=${USERS.tech.id}`, { sess: sess.exec });
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length >= 1);
  assert.deepEqual([r.body.items[0].before.status, r.body.items[0].after.status], ['active', 'blocked']);
  assert.equal(r.body.items[0].user_id, USERS.admin.id);
  const all = await call('GET', '/audit-log?limit=200', { sess: sess.admin });
  const tenants = (await pool.query(`select distinct tenant_id from app.audit_log where id = any($1)`, [all.body.items.map((x: { id: string }) => x.id)])).rows;
  assert.deepEqual(tenants.map((t) => t.tenant_id), [T_A]);
  const since = await call('GET', `/audit-log?from=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, { sess: sess.admin });
  assert.deepEqual(since.body.items, []);
});

test('неверные параметры запроса — 422, а не 500', async () => {
  for (const q of ['status=garbage', 'role=garbage', 'limit=0', 'limit=1000', 'cursor=garbage', 'unknown=1']) {
    const r = await call('GET', `/users?${q}`, { sess: sess.admin });
    assert.equal(r.status, 422, q);
  }
  assert.equal((await call('GET', '/end-users?client_id=garbage', { sess: sess.admin })).status, 422);
  assert.equal((await call('GET', '/audit-log?user_id=garbage', { sess: sess.admin })).status, 422);
});

test('почтовая служба недоступна: приглашение создано (201), ошибка — в журнал', async () => {
  mailer.fail = true;
  try {
    const r = await call('POST', '/users', { sess: sess.admin, body: { email: 'nomail@a.example', name: 'NoMail', role: 'exec' } });
    assert.equal(r.status, 201);
  } finally { mailer.fail = false; }
});

// ---------------------------------------------------------------- гонки: решение под блокировкой строки пользователя

/**
 * Держим строку пользователя, запускаем запрос и ждём, пока он встанет в очередь за нашей блокировкой
 * (pg_blocking_pids), — только тогда меняем учётную запись и отпускаем. Иначе тест зависит от скорости.
 */
async function interleave(userId: string, request: () => Promise<Res>, change: (c: pg.PoolClient) => Promise<void>): Promise<Res> {
  const c = await pool.connect();
  let p: Promise<Res> | undefined;
  try {
    await c.query('begin');
    await c.query('select 1 from app.app_user where id = $1 for update', [userId]);
    const me = (await c.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    p = request();
    const end = Date.now() + 10_000;
    for (;;) {
      const waiting = (await pool.query(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [me])).rows[0].n;
      if (waiting > 0) break;
      if (Date.now() > end) throw new Error('запрос так и не встал за блокировкой строки пользователя');
      await new Promise((r) => setTimeout(r, 10));
    }
    await change(c);
    await c.query('commit');
    return await p;
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
    await p?.catch(() => {}); // запрос не переживает тест
  }
}

test('вход одновременно со сменой пароля: проверяется пароль под блокировкой — старый уже не подходит', async () => {
  const uid = await mkUser('tech');
  const email = (await pool.query('select email from app.app_user where id = $1', [uid])).rows[0].email;
  const other = await hashPassword('completely different pw');
  const r = await interleave(uid, () => call('POST', '/auth/login', { body: { email, password: PW }, ip: freshIp() }),
    async (c) => { await c.query('update app.app_user set password_hash = $2 where id = $1', [uid, other]); });
  assert.equal(r.status, 401);
});

test('приглашение одновременно с блокировкой оператором: блокировка не снимается, ссылка — 410', async () => {
  const uid = await mkUser('tech', 'invited');
  const token = 'race-invitation-token-0123456789';
  await pool.query(`insert into app.auth_token (token_hash, tenant_id, kind, user_id, expires_at) values ($1, $2, 'invitation', $3, now() + interval '1 hour')`,
    [sha256(token), T_A, uid]);
  const r = await interleave(uid, () => call('POST', '/auth/invitations/accept', { body: { token, password: 'race accept pass 1' } }),
    async (c) => { await c.query(`update app.app_user set status = 'blocked' where id = $1`, [uid]); });
  assert.equal(r.status, 410);
  assert.equal((await pool.query('select status from app.app_user where id = $1', [uid])).rows[0].status, 'blocked');
});

test('смена своего пароля гасит ссылки сброса пароля', async () => {
  const n0 = mailer.sent.length;
  await call('POST', '/auth/password/forgot', { body: { email: 'admin@a.example' }, ip: freshIp() });
  await until(() => mailer.sent.length > n0);
  const token = new URL(mailer.sent.at(-1)!.link).searchParams.get('token')!;
  const s = await login('admin@a.example');
  assert.equal((await call('PUT', '/me/password', { sess: s, body: { current_password: PW, new_password: 'admin new password' } })).status, 204);
  assert.equal((await call('POST', '/auth/password/reset', { body: { token, password: 'attacker password' } })).status, 410);
  assert.equal((await call('PUT', '/me/password', { sess: s, body: { current_password: 'admin new password', new_password: PW } })).status, 204);
  sess.admin = await login('admin@a.example');
});

test('приглашение потерялось: «забыли пароль» присылает новое приглашение, старое гаснет', async () => {
  mailer.fail = true;
  let uid: string;
  try {
    uid = (await call('POST', '/users', { sess: sess.admin, body: { email: 'lost@a.example', name: 'Lost', role: 'exec' } })).body.id;
  } finally { mailer.fail = false; }
  const first = (await pool.query(`select token_hash from app.auth_token where user_id = $1`, [uid])).rows;
  assert.equal(first.length, 1);
  const n0 = mailer.sent.length;
  assert.equal((await call('POST', '/auth/password/forgot', { body: { email: 'lost@a.example' }, ip: freshIp() })).status, 202);
  await until(() => mailer.sent.length > n0);
  const m = mailer.sent.at(-1)!;
  assert.deepEqual([m.to, m.kind], ['lost@a.example', 'invitation']);
  const used = (await pool.query(`select used_at from app.auth_token where token_hash = $1`, [first[0].token_hash])).rows[0].used_at;
  assert.ok(used, 'прежнее приглашение погашено');
  const acc = await call('POST', '/auth/invitations/accept', { body: { token: new URL(m.link).searchParams.get('token'), password: 'found at last 123' } });
  assert.equal(acc.status, 200);
});

test('курсор с несуществующей датой — 422', async () => {
  for (const ts of ['2026-02-30T00:00:00.000000Z', '2026-13-01T00:00:00.000000Z', '2026-01-01T00:00:00Z', '0000-01-01T00:00:00.000000Z']) {
    const cur = Buffer.from(JSON.stringify([ts, USERS.admin.id])).toString('base64url');
    assert.equal((await call('GET', `/users?cursor=${cur}`, { sess: sess.admin })).status, 422, ts);
    assert.equal((await call('GET', `/audit-log?cursor=${cur}`, { sess: sess.admin })).status, 422, ts);
  }
});

// ---------------------------------------------------------------- настройки V-006

test('настройки: значения платформы (§7.4) с уровнем; арендатор переопределяет, null — снова платформа', async () => {
  await call('PATCH', '/settings', { sess: sess.admin, body: { upcoming_filters_days: null } }); // после теста матрицы
  const g = await call('GET', '/settings', { sess: sess.admin });
  assert.equal(g.status, 200);
  // Все значения по умолчанию — §7.4.
  const DEFAULTS = { offline_after_min: 3, offline_alert_after_min: 15, hot_alert_below_set_c: 10, hot_alert_above_c: 99,
    hot_alert_after_min: 10, cold_alert_above_set_c: 5, cold_alert_below_c: 1, cold_alert_after_min: 15, filter_warning_pct: 20,
    filter_critical_pct: 5, upcoming_filters_days: 30, filter_forecast_window_days: 30 };
  assert.deepEqual(g.body, Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, { value: v, level: 'platform' }])));
  const u = await call('PATCH', '/settings', { sess: sess.admin, body: { offline_alert_after_min: 30, hot_alert_above_c: 97.5 } });
  assert.equal(u.status, 200);
  assert.deepEqual(u.body.offline_alert_after_min, { value: 30, level: 'tenant' });
  assert.deepEqual(u.body.hot_alert_above_c, { value: 97.5, level: 'tenant' });
  // Другой арендатор этого не видит.
  const b = await login(ADMIN_B.email);
  assert.deepEqual((await call('GET', '/settings', { sess: b })).body.offline_alert_after_min, { value: 15, level: 'platform' });
  const back = await call('PATCH', '/settings', { sess: sess.admin, body: { offline_alert_after_min: null, hot_alert_above_c: null } });
  assert.deepEqual(back.body.offline_alert_after_min, { value: 15, level: 'platform' });
  const a = await call('GET', '/audit-log?action=setting.tenant_update', { sess: sess.admin });
  const set30 = a.body.items.find((i: { after: Record<string, { value: number }> }) => i.after.offline_alert_after_min?.value === 30);
  assert.deepEqual([set30.before.offline_alert_after_min, set30.after.offline_alert_after_min], [{ value: 15, level: 'platform' }, { value: 30, level: 'tenant' }]);
});

test('настройки устройства: устройство → арендатор → платформа; чужое устройство — 404', async () => {
  await call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { offline_after_min: null } }); // после теста матрицы
  await call('PATCH', '/settings', { sess: sess.admin, body: { offline_after_min: 5 } });
  const d0 = await call('GET', `/devices/${D_A}/settings`, { sess: sess.admin });
  assert.deepEqual(d0.body.offline_after_min, { value: 5, level: 'tenant' });
  const d1 = await call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { offline_after_min: 10 } });
  assert.deepEqual(d1.body.offline_after_min, { value: 10, level: 'device' });
  assert.deepEqual((await call('GET', '/settings', { sess: sess.admin })).body.offline_after_min, { value: 5, level: 'tenant' });
  const d2 = await call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { offline_after_min: null } });
  assert.deepEqual(d2.body.offline_after_min, { value: 5, level: 'tenant' });
  await call('PATCH', '/settings', { sess: sess.admin, body: { offline_after_min: null } });
  assert.equal((await call('GET', `/devices/${D_B}/settings`, { sess: sess.admin })).status, 404);
  assert.equal((await call('PATCH', `/devices/${D_B}/settings`, { sess: sess.admin, body: { offline_after_min: 1 } })).status, 404);
  assert.equal((await call('GET', '/devices/not-a-uuid/settings', { sess: sess.admin })).status, 404);
});

test('настройки: вне границ, неизвестный ключ, пустое тело — 422; критичный порог фильтра выше предупреждения — 422', async () => {
  for (const body of [{ filter_warning_pct: 101 }, { offline_after_min: 0 }, { offline_after_min: 2.5 }, { ota_allowed: 1 }, {}, { offline_after_min: '3' }]) {
    assert.equal((await call('PATCH', '/settings', { sess: sess.admin, body })).status, 422, JSON.stringify(body));
  }
  assert.equal((await call('PATCH', '/settings', { sess: sess.admin, body: { filter_critical_pct: 30 } })).status, 422);
  assert.equal((await call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { filter_critical_pct: 25 } })).status, 422);
  // Устройство с переопределением: новое значение арендатора не должно сделать его порог критичного выше предупреждения.
  assert.equal((await call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { filter_critical_pct: 15 } })).status, 200);
  assert.equal((await call('PATCH', '/settings', { sess: sess.admin, body: { filter_warning_pct: 10 } })).status, 422);
  assert.equal((await call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { filter_critical_pct: null } })).status, 200);
  assert.deepEqual((await call('GET', '/settings', { sess: sess.admin })).body.filter_warning_pct, { value: 20, level: 'platform' });
});

test('настройки: аудит изменения устройства и снятия переопределения; после 422 — ни изменения, ни аудита', async () => {
  const count = async (a: string) => (await pool.query(`select count(*)::int as n from app.audit_log where action = $1`, [a])).rows[0].n as number;
  await call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { cold_alert_after_min: 20 } });
  await call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { cold_alert_after_min: null } });
  const a = (await call('GET', `/audit-log?action=setting.device_update&object_id=${D_A}&limit=2`, { sess: sess.admin })).body.items;
  assert.deepEqual([a[0].before.cold_alert_after_min, a[0].after.cold_alert_after_min], [{ value: 20, level: 'device' }, { value: 15, level: 'platform' }]);
  assert.deepEqual([a[1].before.cold_alert_after_min, a[1].after.cold_alert_after_min], [{ value: 15, level: 'platform' }, { value: 20, level: 'device' }]);
  const n0 = await count('setting.tenant_update');
  assert.equal((await call('PATCH', '/settings', { sess: sess.admin, body: { hot_alert_after_min: 30, filter_critical_pct: 50 } })).status, 422);
  assert.equal(await count('setting.tenant_update'), n0);
  assert.deepEqual((await call('GET', '/settings', { sess: sess.admin })).body.hot_alert_after_min, { value: 10, level: 'platform' });
});

test('настройки арендатора и устройства одновременно — правило порогов проверяется по актуальным значениям обоих уровней', async () => {
  await call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { filter_critical_pct: 10 } });
  const c = await pool.connect();
  let p: Promise<Res> | undefined;
  try {
    await c.query('begin');
    await c.query('select 1 from app.tenant where id = $1 for update', [T_A]); // «параллельное изменение арендатора»
    const me = (await c.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    p = call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { filter_critical_pct: 15 } });
    const end = Date.now() + 10_000;
    for (;;) {
      if ((await pool.query(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [me])).rows[0].n > 0) break;
      if (Date.now() > end) throw new Error('изменение устройства не ждёт блокировку арендатора');
      await new Promise((r) => setTimeout(r, 10));
    }
    await c.query(`insert into app.setting (tenant_id, key, value) values ($1, 'filter_warning_pct', '12')`, [T_A]);
    await c.query('commit');
    assert.equal((await p!).status, 422); // 15 > 12 — по значению арендатора, закоммиченному первым
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
    await p?.catch(() => {});
  }
  await call('PATCH', `/devices/${D_A}/settings`, { sess: sess.admin, body: { filter_critical_pct: null } });
  await call('PATCH', '/settings', { sess: sess.admin, body: { filter_warning_pct: null } });
});

test('настройки и вход того же Admin одновременно — без взаимной блокировки (deadlock → 500)', async () => {
  // Как вход: держим строку пользователя, затем пишем сессию (проверка FK берёт KEY SHARE на арендатора).
  const c = await pool.connect();
  let p: Promise<Res> | undefined;
  try {
    await c.query('begin');
    // Худший случай — строка пользователя под FOR UPDATE: настройки (уже держат арендатора) ждут её на FK updated_by.
    await c.query('select 1 from app.app_user where id = $1 for update', [USERS.admin.id]);
    const me = (await c.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    p = call('PATCH', '/settings', { sess: sess.admin, body: { upcoming_filters_days: 31 } });
    const end = Date.now() + 10_000;
    for (;;) {
      if ((await pool.query(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [me])).rows[0].n > 0) break;
      if (Date.now() > end) throw new Error('настройки не встали за строкой пользователя');
      await new Promise((r) => setTimeout(r, 10));
    }
    // Теперь вставка сессии берёт KEY SHARE на арендатора: при FOR UPDATE арендатора здесь была бы взаимная блокировка.
    await c.query(`insert into app.auth_session (id_hash, tenant_id, user_id, expires_at) values ('deadlock-probe', $1, $2, now() + interval '1 minute')`, [T_A, USERS.admin.id]);
    await c.query('commit');
    assert.equal((await p!).status, 200);
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
    await p?.catch(() => {});
  }
  await call('PATCH', '/settings', { sess: sess.admin, body: { upcoming_filters_days: null } });
});
