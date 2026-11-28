// Клиенты, адреса, контакты (§4.3) и реестр устройств (§4.2), карта (V-025…V-027) — на PostgreSQL через API.
// Каждый успешный ответ проверяется по схеме контракта; права — по матрице 7.1 (roles-matrix.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { migrateDb } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { MemoryMailer } from '../src/mail.ts';
import { RateLimiter } from '../src/http/rate-limit.ts';
import { hashPassword } from '../src/auth/crypto.ts';
import { operations } from '../src/openapi/spec.ts';
import { repoRoot } from '../src/paths.ts';
import type { Config } from '../src/config.ts';
import type { Geocoder } from '../src/geocoder.ts';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL не задан');
const dbName = `icooler_reg_${process.pid}_${Date.now()}`;
const url = new URL(ADMIN_URL);
url.pathname = `/${dbName}`;
const T_A = '11111111-1111-4111-8111-111111111111';
const T_B = '22222222-2222-4222-8222-222222222222';
const PW = 'correct horse battery';
const ROLES = ['admin', 'tech', 'exec', 'dispatcher', 'end_user', 'sig_admin'] as const;
type Role = (typeof ROLES)[number];
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let app: NestFastifyApplication;
let pool: pg.Pool;
interface Sess { cookie: string; csrf: string }
interface Res { status: number; body: any }
const sess = {} as Record<Role | 'adminB', Sess>;

const ROUTES = [...operations().values()].map((o) => ({ o, re: new RegExp(`^${o.path.replace(/\{\w+\}/g, '[^/]+')}$`) }));
async function call(method: string, path: string, s?: Sess, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = {};
  if (s) { headers['cookie'] = s.cookie; headers['x-csrf-token'] = s.csrf; }
  const r = await app.inject({ method: method as 'GET', url: `/api/v1${path}`, headers, ...(body !== undefined ? { payload: body as object } : {}) });
  const res = { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  const op = ROUTES.find((x) => x.o.method === method && x.re.test(path.split('?')[0]!))?.o;
  assert.ok(op, `нет операции для ${method} ${path}`);
  if (res.status >= 200 && res.status < 300) {
    const v = op.responses.get(String(res.status));
    if (v) assert.ok(v(res.body), `${op.id} ${res.status}: не по схеме ${JSON.stringify(v.errors)} ${JSON.stringify(res.body).slice(0, 400)}`);
  }
  return res;
}
const get = (p: string, s: Sess = sess.admin) => call('GET', p, s);
const send = (m: string, p: string, body?: unknown, s: Sess = sess.admin) => call(m, p, s, body);

async function login(email: string): Promise<Sess> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PW } });
  assert.equal(r.statusCode, 200, r.body);
  return { cookie: String(r.headers['set-cookie']).split(';')[0]!, csrf: JSON.parse(r.body).csrf_token };
}

const MATRIX = JSON.parse(readFileSync(join(repoRoot(), 'contracts/openapi/roles-matrix.json'), 'utf8')) as {
  rows: { cells?: Record<string, string>; view?: string[]; change?: string[]; eu_operations?: string[] }[];
};
function expectedRoles(opId: string): Role[] {
  for (const r of MATRIX.rows) {
    if (r.eu_operations?.includes(opId)) return ['end_user'];
    const kind = r.view?.includes(opId) ? 'view' : r.change?.includes(opId) ? 'change' : null;
    if (kind) return ROLES.filter((x) => x !== 'end_user' && (r.cells![x] === '✅' || (kind === 'view' && r.cells![x] === '👁')));
  }
  throw new Error(`${opId}: нет в матрице`);
}

let seq = 0;
const next = () => ++seq;
async function mkClient(name = `Client ${next()}`, s: Sess = sess.admin): Promise<string> {
  const r = await send('POST', '/clients', { type: 'organization', name }, s);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}
async function mkAddress(clientId: string, extra: object = {}): Promise<string> {
  const r = await send('POST', `/clients/${clientId}/addresses`, { address: `Street ${next()}`, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}
async function mkDevice(extra: object = {}, s: Sess = sess.admin): Promise<string> {
  const n = next();
  const r = await send('POST', '/devices', { device_id: `dev-${n}`, serial: `SN-${n}`, model: { water_source: 'mains', variant: 'A', carbonated: false }, ...extra }, s);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

before(async () => {
  const adm = new pg.Client({ connectionString: ADMIN_URL });
  await adm.connect();
  await adm.query(`create database ${dbName}`);
  await adm.end();
  await migrateDb(url.toString());
  pool = new pg.Pool({ connectionString: url.toString() });
  const h = await hashPassword(PW);
  await pool.query(`insert into app.tenant (id, name, code) values ($1, 'A', 'ten-a'), ($2, 'B', 'ten-b')`, [T_A, T_B]);
  const users: [string, string | null, string, string][] = [
    [uid(1), T_A, 'admin@a.example', 'admin'], [uid(2), T_A, 'tech@a.example', 'tech'], [uid(3), T_A, 'exec@a.example', 'exec'],
    [uid(4), T_A, 'disp@a.example', 'dispatcher'], [uid(5), T_A, 'eu@a.example', 'end_user'], [uid(6), null, 'sig@s.example', 'sig_admin'],
    [uid(11), T_B, 'admin@b.example', 'admin'],
  ];
  for (const [id, t, email, role] of users) {
    await pool.query(`insert into app.app_user (id, tenant_id, email, name, status, password_hash) values ($1, $2, $3, $4, 'active', $5)`, [id, t, email, role, h]);
    await pool.query(`insert into app.role_assignment (user_id, tenant_id, role) values ($1, $2, $3)`, [id, t, role]);
  }
  const cfg: Config = {
    databaseUrl: url.toString(), dbRole: 'app_api', csrfSecret: 'test-secret-0123456789', cookieSecure: true, trustProxyHops: 0,
    publicUrl: 'https://portal.example', operatorSessionH: 12, endUserSessionDays: 30, invitationH: 72, passwordResetH: 1, loginMaxFailures: 5, loginLockoutMin: 15,
  };
  // Подставной геокодер: адреса с «geo:<lat>,<lng>» находятся, остальные — нет.
  const geocoder: Geocoder = { async geocode(a) { const m = /geo:([\d.]+),([\d.]+)/.exec(a); return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null; } };
  app = await createApp(cfg, new MemoryMailer(), new RateLimiter(), geocoder);
  for (const [role, email] of [['admin', 'admin@a.example'], ['tech', 'tech@a.example'], ['exec', 'exec@a.example'], ['dispatcher', 'disp@a.example'],
    ['end_user', 'eu@a.example'], ['sig_admin', 'sig@s.example'], ['adminB', 'admin@b.example']] as const) sess[role] = await login(email);
});

after(async () => {
  await app?.close();
  await pool?.end();
  const adm = new pg.Client({ connectionString: ADMIN_URL });
  await adm.connect();
  await adm.query(`drop database if exists ${dbName} with (force)`);
  await adm.end();
});

test('права: 20 операций × 6 ролей — разрешено 2xx, запрещено 403 (матрица 7.1)', async () => {
  const REQ: Record<string, () => Promise<[string, string, unknown?]>> = {
    listClients: async () => ['GET', '/clients'],
    createClient: async () => ['POST', '/clients', { type: 'person', name: 'P' }],
    getClient: async () => ['GET', `/clients/${await mkClient()}`],
    updateClient: async () => ['PATCH', `/clients/${await mkClient()}`, { type: 'organization', name: 'Renamed' }],
    deleteClient: async () => ['DELETE', `/clients/${await mkClient()}`],
    createAddress: async () => ['POST', `/clients/${await mkClient()}/addresses`, { address: 'X' }],
    updateAddress: async () => ['PATCH', `/addresses/${await mkAddress(await mkClient())}`, { address: 'Y' }],
    deleteAddress: async () => ['DELETE', `/addresses/${await mkAddress(await mkClient())}`],
    createContact: async () => ['POST', `/clients/${await mkClient()}/contacts`, { name: 'C' }],
    updateContact: async () => {
      const c = await send('POST', `/clients/${await mkClient()}/contacts`, { name: 'C' });
      return ['PATCH', `/contacts/${c.body.id}`, { name: 'D' }];
    },
    deleteContact: async () => {
      const c = await send('POST', `/clients/${await mkClient()}/contacts`, { name: 'C' });
      return ['DELETE', `/contacts/${c.body.id}`];
    },
    listDevices: async () => ['GET', '/devices'],
    createDevice: async () => { const n = next(); return ['POST', '/devices', { device_id: `m-${n}`, serial: `M-${n}`, model: { water_source: 'mains', variant: 'S', carbonated: true } }]; },
    getDevice: async () => ['GET', `/devices/${await mkDevice()}`],
    updateDevice: async () => ['PATCH', `/devices/${await mkDevice()}`, { description: 'x' }],
    transferDevice: async () => ['POST', `/devices/${await mkDevice()}/transfer`, { client_id: await mkClient(), address_id: null }],
    setLifecycle: async () => ['PUT', `/devices/${await mkDevice()}/lifecycle`, { lifecycle: 'installed' }],
    setOwnership: async () => ['PUT', `/devices/${await mkDevice()}/ownership`, { ownership: 'rent' }],
    getDeviceHistory: async () => ['GET', `/devices/${await mkDevice()}/history`],
    getMap: async () => ['GET', '/map?bbox=20,55,30,60&zoom=6'],
  };
  for (const [opId, req] of Object.entries(REQ)) {
    for (const role of ROLES) {
      const [m, p, b] = await req();
      const allowed = expectedRoles(opId).includes(role);
      const r = await call(m, p, sess[role], b);
      if (allowed) assert.ok(r.status >= 200 && r.status < 300, `${opId} ${role}: ожидалось 2xx, ${r.status} ${JSON.stringify(r.body)}`);
      else assert.equal(r.status, 403, `${opId} ${role}: ожидалось 403, ${r.status}`);
    }
  }
});

test('клиент: карточка с адресами, контактами и кулерами; изменение; список с поиском и регионом', async () => {
  const id = await mkClient('SIA Birojs');
  const a = await send('POST', `/clients/${id}/addresses`, { address: 'Brīvības 1', region: 'Rīga', lat: 56.95, lng: 24.11, floor: '3', place: 'Кухня' });
  assert.equal(a.body.coords_source, 'manual');
  const noGeo = await send('POST', `/clients/${id}/addresses`, { address: 'Без координат' });
  assert.deepEqual([noGeo.body.lat, noGeo.body.lng, noGeo.body.coords_source], [null, null, undefined]);
  await send('POST', `/clients/${id}/contacts`, { name: 'Jānis', phone: '+371 20000000', email: 'j@x.example' });
  const d = await mkDevice();
  assert.equal((await send('POST', `/devices/${d}/transfer`, { client_id: id, address_id: a.body.id })).status, 200);
  const card = await get(`/clients/${id}`);
  assert.equal(card.status, 200);
  assert.deepEqual([card.body.addresses.length, card.body.contacts.length, card.body.devices.length], [2, 1, 1]);
  assert.deepEqual([card.body.devices[0].floor, card.body.devices[0].place, card.body.devices[0].state], ['3', 'Кухня', 'offline']);
  assert.equal((await send('PATCH', `/clients/${id}`, { type: 'organization', name: 'SIA Birojs Plus', reg_number: '4000' })).body.name, 'SIA Birojs Plus');
  const byQ = await get('/clients?q=Birojs%20Plus');
  assert.deepEqual(byQ.body.items.map((x: { id: string }) => x.id), [id]);
  assert.equal(byQ.body.items[0].devices_total, 1);
  assert.deepEqual((await get('/clients?region=R%C4%ABga')).body.items.map((x: { id: string }) => x.id), [id]);
});

test('удаление: клиент или адрес с устройствами — 409; после переноса — удаляется вместе с адресами и контактами', async () => {
  const id = await mkClient();
  const addr = await mkAddress(id);
  const d = await mkDevice();
  await send('POST', `/devices/${d}/transfer`, { client_id: id, address_id: addr });
  assert.equal((await send('DELETE', `/addresses/${addr}`)).status, 409);
  assert.equal((await send('DELETE', `/clients/${id}`)).status, 409);
  await send('POST', `/devices/${d}/transfer`, { client_id: null, address_id: null });
  assert.equal((await send('DELETE', `/clients/${id}`)).status, 204);
  assert.equal((await get(`/clients/${id}`)).status, 404);
  assert.equal((await send('PATCH', `/addresses/${addr}`, { address: 'x' })).status, 404);
});

test('уникальность V-011: серийник — у арендатора, Device ID и IMEI — во всей платформе (без раскрытия чьё)', async () => {
  await mkDevice({ device_id: 'uniq-1', serial: 'U-1', imei: '356938035643809' });
  assert.equal((await send('POST', '/devices', { device_id: 'uniq-2', serial: 'U-1', model: { water_source: 'mains', variant: 'A', carbonated: false } })).status, 409);
  // Другой арендатор: тот же серийник можно, тот же Device ID и IMEI — нет.
  assert.equal((await send('POST', '/devices', { device_id: 'uniq-b', serial: 'U-1', model: { water_source: 'mains', variant: 'A', carbonated: false } }, sess.adminB)).status, 201);
  const dup = await send('POST', '/devices', { device_id: 'uniq-1', serial: 'U-B2', model: { water_source: 'mains', variant: 'A', carbonated: false } }, sess.adminB);
  assert.equal(dup.status, 409);
  assert.doesNotMatch(dup.body.detail, /A\b|tenant|арендатор/);
  assert.equal((await send('POST', '/devices', { device_id: 'uniq-b3', serial: 'U-B3', imei: '356938035643809', model: { water_source: 'mains', variant: 'A', carbonated: false } }, sess.adminB)).status, 409);
  const other = await mkDevice();
  assert.equal((await send('PATCH', `/devices/${other}`, { serial: 'U-1' })).status, 409);
  assert.equal((await send('PATCH', `/devices/${other}`, { description: 'тот же серийник у себя — не конфликт' })).status, 200);
});

test('перенос: адрес другого клиента — 422, клиент другого арендатора — 404; история клиента и адреса', async () => {
  const c1 = await mkClient(), c2 = await mkClient();
  const a2 = await mkAddress(c2);
  const d = await mkDevice();
  assert.equal((await send('POST', `/devices/${d}/transfer`, { client_id: c1, address_id: a2 })).status, 422);
  const bClient = await mkClient('B client', sess.adminB);
  assert.equal((await send('POST', `/devices/${d}/transfer`, { client_id: bClient, address_id: null })).status, 404);
  const r = await send('POST', `/devices/${d}/transfer`, { client_id: c2, address_id: a2, comment: 'монтаж' });
  assert.deepEqual([r.body.client_id, r.body.address_id], [c2, a2]);
  const h = (await get(`/devices/${d}/history`)).body.items;
  assert.deepEqual(h.map((x: { field: string }) => x.field).sort(), ['address', 'client']);
  assert.equal(h[0].comment, 'монтаж');
  assert.equal(h[0].by, uid(1));
});

test('статус жизненного цикла и аренда/покупка — с историей; то же значение — без записи', async () => {
  const d = await mkDevice();
  assert.equal((await send('PUT', `/devices/${d}/lifecycle`, { lifecycle: 'installed', comment: 'смонтирован' })).body.lifecycle, 'installed');
  assert.equal((await send('PUT', `/devices/${d}/lifecycle`, { lifecycle: 'installed' })).status, 200);
  assert.equal((await send('PUT', `/devices/${d}/ownership`, { ownership: 'rent' })).body.ownership, 'rent');
  const h = (await get(`/devices/${d}/history`)).body.items;
  assert.deepEqual(h.map((x: { field: string; before: string; after: string }) => [x.field, x.before, x.after]),
    [['ownership', 'purchase', 'rent'], ['lifecycle', 'stock', 'installed']]);
  assert.equal((await send('PUT', `/devices/${d}/lifecycle`, { lifecycle: 'flying' })).status, 422);
});

test('карточка устройства: клиент и адрес; состояние до телеметрии — не выходило на связь', async () => {
  const c = await mkClient('Card client');
  const a = await mkAddress(c, { floor: '2' });
  const d = await mkDevice({ imei: '490154203237518' });
  await send('POST', `/devices/${d}/transfer`, { client_id: c, address_id: a });
  const r = await get(`/devices/${d}`, sess.exec);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.client.name, r.body.address_detail.floor, r.body.state, r.body.online, r.body.last_seen_at, r.body.current], ['Card client', '2', 'offline', false, null, null]);
  assert.equal((await get(`/devices/${d}`, sess.adminB)).status, 404);
  assert.equal((await get('/devices/not-a-uuid')).status, 404);
});

test('список устройств: фильтры реестра, фильтры состояния согласованы с ответом, сортировка и страницы', async () => {
  const c = await mkClient('Filter client');
  const a = await mkAddress(c, { region: 'Kurzeme' });
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push(await mkDevice({ serial: `F-${i}`, device_id: `filter-${i}`, model: { water_source: 'bottle_top', variant: 'A', carbonated: false, sku: 'SS_BOT_UP_CHA' } }));
  for (const d of ids.slice(0, 3)) await send('POST', `/devices/${d}/transfer`, { client_id: c, address_id: a });
  await send('PUT', `/devices/${ids[0]}/ownership`, { ownership: 'rent' });
  const q = async (s: string) => (await get(`/devices?limit=200&${s}`)).body.items.map((x: { id: string }) => x.id).sort();
  assert.deepEqual(await q(`client_id=${c}`), ids.slice(0, 3).sort());
  assert.deepEqual(await q('region=Kurzeme'), ids.slice(0, 3).sort());
  assert.deepEqual(await q(`client_id=${c}&ownership=rent`), [ids[0]]);
  assert.deepEqual(await q('q=filter-'), [...ids].sort());
  assert.deepEqual((await q('model=SS_BOT_UP_CHA')).length >= 5, true);
  // Состояние — как в ответе: все «offline», алертов нет, ресурса фильтра нет, прошивка неизвестна.
  assert.ok((await q('state=offline')).length >= 5);
  assert.deepEqual(await q('state=operational'), []);
  assert.deepEqual(await q('alert_type=offline'), []);
  assert.deepEqual(await q('filter_left_max_pct=50'), []);
  assert.deepEqual(await q('fw=1.0.0'), []);
  // Сортировка по серийнику и страницы без пропусков.
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const r: Res = await get(`/devices?q=filter-&sort=serial&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
    seen.push(...r.body.items.map((x: { serial: string }) => x.serial));
    cursor = r.body.next_cursor;
  } while (cursor);
  assert.deepEqual(seen, ['F-0', 'F-1', 'F-2', 'F-3', 'F-4']);
  const desc = (await get('/devices?q=filter-&sort=-serial&limit=200')).body.items.map((x: { serial: string }) => x.serial);
  assert.deepEqual(desc, ['F-4', 'F-3', 'F-2', 'F-1', 'F-0']);
  assert.equal((await get('/devices?sort=password')).status, 422);
  const c1 = (await get('/devices?q=filter-&sort=serial&limit=1')).body.next_cursor;
  assert.equal((await get(`/devices?sort=device_id&cursor=${c1}`)).status, 422); // курсор другой сортировки
  assert.equal((await get('/devices?lifecycle=flying')).status, 422);
});

test('карта: рамка, кластеры на мелком масштабе, отдельные маркеры на крупном и на одном адресе (P-05)', async () => {
  const c = await mkClient('Map client');
  const riga1 = await mkAddress(c, { lat: 56.9500, lng: 24.1000, floor: '1' });
  const riga2 = await mkAddress(c, { lat: 56.9510, lng: 24.1010, floor: '5' });
  const liepaja = await mkAddress(c, { lat: 56.5100, lng: 21.0100 });
  const d1 = await mkDevice(), d2 = await mkDevice(), d3 = await mkDevice(), d4 = await mkDevice();
  await send('POST', `/devices/${d1}/transfer`, { client_id: c, address_id: riga1 });
  await send('POST', `/devices/${d2}/transfer`, { client_id: c, address_id: riga2 });
  await send('POST', `/devices/${d3}/transfer`, { client_id: c, address_id: liepaja });
  await send('POST', `/devices/${d4}/transfer`, { client_id: c, address_id: riga1 }); // второй кулер на том же адресе
  const low = (await get(`/map?bbox=20,55,30,60&zoom=6&client_id=${c}`)).body;
  assert.equal(low.clusters.length, 1);
  assert.deepEqual([low.clusters[0].count, low.clusters[0].by_color], [3, { grey: 3 }]);
  assert.deepEqual(low.devices.map((x: { id: string }) => x.id), [d3]);
  const high = (await get(`/map?bbox=24.09,56.94,24.11,56.96&zoom=18&client_id=${c}`)).body;
  assert.deepEqual([high.clusters.length, high.devices.length], [0, 3]);
  const one = (await get(`/map?bbox=24.0999,56.9499,24.1001,56.9501&zoom=10&client_id=${c}`)).body;
  assert.deepEqual(one.devices.map((x: { id: string }) => x.id).sort(), [d1, d4].sort()); // один адрес — различимы
  assert.deepEqual(one.devices.map((x: { floor: string }) => x.floor), ['1', '1']);
  assert.equal((await get('/map?bbox=30,55,20,60&zoom=6')).status, 422);
  assert.equal((await get('/map?bbox=a,b,c,d&zoom=6')).status, 422);
  assert.equal((await get('/map?bbox=20,55,30,95&zoom=6')).status, 422); // широта вне диапазона
  assert.equal((await get('/map?bbox=20,55,30,60')).status, 422); // zoom обязателен
  assert.equal((await get(`/map?bbox=20,55,30,60&zoom=6&state=operational&client_id=${c}`)).body.devices.length, 0);
});

test('аудит: создание, перенос, статус', async () => {
  const d = await mkDevice();
  await send('POST', `/devices/${d}/transfer`, { client_id: await mkClient(), address_id: null });
  await send('PUT', `/devices/${d}/lifecycle`, { lifecycle: 'maintenance' });
  const items = (await get(`/audit-log?object_id=${d}`)).body.items.map((x: { action: string }) => x.action);
  assert.deepEqual(items, ['device.lifecycle', 'device.transfer', 'device.create']);
});

/** Держим строку, запускаем запрос, ждём, пока он встанет за блокировкой (pg_blocking_pids), меняем и отпускаем. */
async function interleave(lockSql: string, lockArgs: unknown[], request: () => Promise<Res>, change: (c: pg.PoolClient) => Promise<void>): Promise<Res> {
  const c = await pool.connect();
  let p: Promise<Res> | undefined;
  try {
    await c.query('begin');
    await c.query(lockSql, lockArgs);
    const me = (await c.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    p = request();
    const end = Date.now() + 10_000;
    for (;;) {
      if ((await pool.query(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [me])).rows[0].n > 0) break;
      if (Date.now() > end) throw new Error('запрос не встал за блокировкой');
      await new Promise((r) => setTimeout(r, 10));
    }
    await change(c);
    await c.query('commit');
    return await p;
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
    await p?.catch(() => {});
  }
}

test('перенос одновременно с удалением клиента: устройство не остаётся у удалённого клиента', async () => {
  const cl = await mkClient();
  const d = await mkDevice();
  // Удаление клиента (держит его строку) закончилось раньше — перенос получает 404.
  const r = await interleave('select 1 from app.client where id = $1 for no key update', [cl],
    () => send('POST', `/devices/${d}/transfer`, { client_id: cl, address_id: null }),
    async (c) => { await c.query('update app.client set deleted_at = now() where id = $1', [cl]); });
  assert.equal(r.status, 404);
  assert.equal((await pool.query('select client_id from app.device where id = $1', [d])).rows[0].client_id, null);
  // Обратно: перенос закончился раньше — удаление видит устройство и отвечает 409.
  const cl2 = await mkClient();
  const d2 = await mkDevice();
  const r2 = await interleave('select 1 from app.client where id = $1 for no key update', [cl2],
    () => send('DELETE', `/clients/${cl2}`),
    async (c) => { await c.query('update app.device set client_id = $2 where id = $1', [d2, cl2]); });
  assert.equal(r2.status, 409);
});

test('сортировка по имени клиента: длинные кириллические имена и одинаковые значения — страницы без пропусков', async () => {
  const long = 'Ж'.repeat(200);
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const cl = await mkClient(i < 3 ? long : `${long.slice(0, 199)}Я`);
    const d = await mkDevice({ device_id: `long-${i}`, serial: `L-${i}` });
    await send('POST', `/devices/${d}/transfer`, { client_id: cl, address_id: null });
    ids.push(d);
  }
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const r: Res = await get(`/devices?q=long-&sort=client_name&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    seen.push(...r.body.items.map((x: { id: string }) => x.id));
    cursor = r.body.next_cursor;
    if (cursor) assert.ok(cursor.length <= 512);
  } while (cursor);
  assert.deepEqual([...seen].sort(), [...ids].sort());
  assert.equal(seen.at(-1), ids[3]); // «…Я» — последним
  for (const s2 of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal((await get(`/devices?sort=${s2}`)).status, 422, s2);
});

test('пустые после обрезки имена — 422, а не сохранение пустой строки', async () => {
  assert.equal((await send('POST', '/clients', { type: 'person', name: '   ' })).status, 422);
  const cl = await mkClient();
  assert.equal((await send('PATCH', `/clients/${cl}`, { type: 'person', name: ' ' })).status, 422);
  assert.equal((await send('POST', `/clients/${cl}/addresses`, { address: '  ' })).status, 422);
  assert.equal((await send('POST', `/clients/${cl}/contacts`, { name: '  ' })).status, 422);
  assert.equal((await send('POST', '/devices', { device_id: 'blank-1', serial: '  ', model: { water_source: 'mains', variant: 'A', carbonated: false } })).status, 422);
  assert.equal((await send('PATCH', `/devices/${await mkDevice()}`, { serial: '   ' })).status, 422);
  const sp = await send('POST', '/devices', { device_id: 'trim-1', serial: '  T-1  ', model: { water_source: 'mains', variant: 'A', carbonated: false } });
  assert.equal(sp.body.serial, 'T-1');
});

test('геокодирование V-022: без координат — по адресу; не нашлось — без координат; ручные — как заданы', async () => {
  const cl = await mkClient();
  const g = await send('POST', `/clients/${cl}/addresses`, { address: 'Brīvības 1, Rīga geo:56.95,24.11' });
  assert.deepEqual([g.body.lat, g.body.lng, g.body.coords_source], [56.95, 24.11, 'geocoded']);
  const none = await send('POST', `/clients/${cl}/addresses`, { address: 'Nekur 0' });
  assert.deepEqual([none.body.lat, none.body.coords_source], [null, undefined]);
  const manual = await send('POST', `/clients/${cl}/addresses`, { address: 'X geo:1,1', lat: 57, lng: 25 });
  assert.deepEqual([manual.body.lat, manual.body.lng, manual.body.coords_source], [57, 25, 'manual']);
  const upd = await send('PATCH', `/addresses/${none.body.id}`, { address: 'Found geo:56.5,21.01' });
  assert.deepEqual([upd.body.lat, upd.body.coords_source], [56.5, 'geocoded']);
});

test('карта: ни одно устройство в рамке не теряется — сумма кластеров и маркеров равна числу устройств', async () => {
  const cl = await mkClient('Many');
  const n = 60;
  for (let i = 0; i < n; i++) {
    const a = await mkAddress(cl, { lat: 40 + (i % 10) * 0.3, lng: 10 + Math.floor(i / 10) * 0.3 });
    const d = await mkDevice();
    await send('POST', `/devices/${d}/transfer`, { client_id: cl, address_id: a });
  }
  for (const zoom of [3, 6, 9, 18]) {
    const m = (await get(`/map?bbox=0,30,20,50&zoom=${zoom}&client_id=${cl}`)).body;
    const total = m.clusters.reduce((s2: number, c2: { count: number }) => s2 + c2.count, 0) + m.devices.length;
    assert.equal(total, n, `zoom ${zoom}`);
  }
});

test('ota_allowed в карточке — по hello устройства: до телеметрии null, даже если настройка задана', async () => {
  const d = await mkDevice();
  await pool.query(`insert into app.setting (tenant_id, device_id, key, value) values ($1, $2, 'ota_allowed', 'true')`, [T_A, d]);
  assert.equal((await get(`/devices/${d}`)).body.ota_allowed, null);
});

test('перенос одновременно с удалением адреса — в обоих порядках', async () => {
  const cl = await mkClient();
  const a1 = await mkAddress(cl);
  const d = await mkDevice();
  const r = await interleave('select 1 from app.address where id = $1 for no key update', [a1],
    () => send('POST', `/devices/${d}/transfer`, { client_id: cl, address_id: a1 }),
    async (c) => { await c.query('update app.address set deleted_at = now() where id = $1', [a1]); });
  assert.equal(r.status, 404);
  assert.equal((await pool.query('select address_id from app.device where id = $1', [d])).rows[0].address_id, null);
  const a2 = await mkAddress(cl);
  const d2 = await mkDevice();
  const r2 = await interleave('select 1 from app.address where id = $1 for no key update', [a2],
    () => send('DELETE', `/addresses/${a2}`),
    async (c) => { await c.query('update app.device set client_id = $2, address_id = $3 where id = $1', [d2, cl, a2]); });
  assert.equal(r2.status, 409);
});
