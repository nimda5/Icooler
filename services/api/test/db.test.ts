// Схема app на настоящем PostgreSQL: миграции с нуля, RLS по арендатору (P-07), только добавление в аудит,
// права ролей и контракт для дорожки «Устройство» (contracts/db/app-interface.json, §6.3).
// Нужен DATABASE_URL с правом создавать базы: тест создаёт свою временную базу и удаляет её.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { join } from 'node:path';
import { migrateDb } from '../src/db/migrate.ts';
import { repoRoot } from '../src/paths.ts';

const ADMIN_URL = process.env['DATABASE_URL'];
if (!ADMIN_URL) throw new Error('DATABASE_URL не задан — см. services/api/README.md');
const dbName = `icooler_test_${process.pid}_${Date.now()}`;
const url = new URL(ADMIN_URL);
url.pathname = `/${dbName}`;
let pool: pg.Pool;

const T_A = '11111111-1111-4111-8111-111111111111';
const T_B = '22222222-2222-4222-8222-222222222222';
const U_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const U_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const C_A = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const C_B = 'bbbbbbbb-0000-4000-8000-0000000000c1';
const D_A = 'aaaaaaaa-0000-4000-8000-0000000000d1';
const D_B = 'bbbbbbbb-0000-4000-8000-0000000000d1';

const owner = (q: string, v: unknown[] = []) => pool.query(q, v);

/** Транзакция под ролью; tenant — app.tenant_id. Откатывается всегда: тесты не мешают друг другу. */
async function as<T>(role: 'app_api' | 'app_device', tenant: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    if (tenant) await c.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
  }
}
const denied = /permission denied|row-level security|только добавление/;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  await migrateDb(url.toString());
  pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  await owner(`insert into app.tenant (id, name, code) values ($1, 'VENDEN', 'venden'), ($2, 'Other', 'other')`, [T_A, T_B]);
  await owner(`insert into app.app_user (id, tenant_id, email, name, status) values
    ($1, $3, 'Admin@Venden.lv', 'Admin A', 'active'), ($2, $4, 'admin@other.lv', 'Admin B', 'active')`, [U_A, U_B, T_A, T_B]);
  await owner(`insert into app.role_assignment (user_id, tenant_id, role) values ($1, $3, 'admin'), ($2, $4, 'admin')`, [U_A, U_B, T_A, T_B]);
  await owner(`insert into app.client (id, tenant_id, type, name) values ($1, $3, 'organization', 'A1'), ($2, $4, 'organization', 'B1')`, [C_A, C_B, T_A, T_B]);
  await owner(`insert into app.device (id, tenant_id, device_id, serial, water_source, variant, carbonated, client_id) values
    ($1, $3, 'cooler-a1', 'SN-1', 'bottle_top', 'A', true, $5), ($2, $4, 'cooler-b1', 'SN-1', 'mains', 'S', false, $6)`,
  [D_A, D_B, T_A, T_B, C_A, C_B]);
  await owner(`insert into app.setting (tenant_id, device_id, key, value) values ($1, $2, 'ota_allowed', 'true'),
    ($1, null, 'offline_alert_after_min', '30')`, [T_A, D_A]);
});

after(async () => {
  await pool?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

test('миграции с нуля: схема app, RLS у каждой таблицы с tenant_id, политика для app_api', async () => {
  const { rows } = await owner(`
    select c.relname, c.relrowsecurity,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as has_tenant,
           exists (select 1 from pg_policy p where p.polrelid = c.oid) as has_policy
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'r' order by 1`);
  assert.ok(rows.length >= 20, `таблиц ${rows.length}`);
  for (const r of rows) {
    if (r.has_tenant || r.relname === 'tenant') {
      assert.ok(r.relrowsecurity, `${r.relname}: RLS выключен`);
      assert.ok(r.has_policy, `${r.relname}: нет политики`);
    } else {
      assert.ok(['auth_session', 'auth_token', 'error_code', 'setting_default'].includes(r.relname), `${r.relname}: без tenant_id и не в списке исключений`);
    }
  }
});

test('время событий — в колонках по смыслу, а не в created_at', async () => {
  const want: Record<string, string> = {
    role_assignment: 'assigned_at', end_user_access: 'bound_at', device_history: 'at', consumption_reset: 'at',
    filter_install: 'installed_at', schedule_local_report: 'received_at', setting: 'updated_at', audit_log: 'at', notification: 'at',
  };
  for (const [t, col] of Object.entries(want)) {
    const cols = (await owner(`select column_name from information_schema.columns where table_schema = 'app' and table_name = $1`, [t])).rows.map((r) => r.column_name);
    assert.ok(cols.includes(col), `${t}: нет ${col}`);
    assert.ok(!cols.includes('created_at'), `${t}: лишняя created_at`);
  }
});

test('RLS: арендатор видит и пишет только своё; без арендатора — ничего', async () => {
  await as('app_api', T_A, async (c) => {
    assert.deepEqual((await c.query('select id from app.device')).rows.map((r) => r.id), [D_A]);
    assert.deepEqual((await c.query('select id from app.client')).rows.map((r) => r.id), [C_A]);
    assert.equal((await c.query('select count(*)::int as n from app.tenant')).rows[0].n, 1);
    assert.equal((await c.query(`update app.device set description = 'x' where id = $1`, [D_B])).rowCount, 0);
  });
  await assert.rejects(as('app_api', T_A, (c) => c.query(
    `insert into app.client (tenant_id, type, name) values ($1, 'person', 'чужой')`, [T_B])), denied);
  await as('app_api', null, async (c) => {
    assert.equal((await c.query('select count(*)::int as n from app.device')).rows[0].n, 0);
  });
});

test('app_api: удаление только логическое; аудит и история — только добавление', async () => {
  await assert.rejects(as('app_api', T_A, (c) => c.query('delete from app.client where id = $1', [C_A])), denied);
  await as('app_api', T_A, async (c) => {
    await c.query(`insert into app.audit_log (tenant_id, user_id, actor, action, object_type) values ($1, $2, 'user', 'client.create', 'client')`, [T_A, U_A]);
  });
  await assert.rejects(as('app_api', T_A, (c) => c.query(`update app.audit_log set action = 'x'`)), denied);
  await assert.rejects(owner(`delete from app.audit_log`), /только добавление/); // и владельцу
  await assert.rejects(owner(`update app.device_history set comment = 'x'`), /только добавление/);
});

test('ссылки только внутри арендатора: чужое устройство, клиент, адрес другого клиента — отказ', async () => {
  const fk = /violates foreign key constraint/;
  await assert.rejects(as('app_api', T_A, (c) => c.query(
    `insert into app.setting (tenant_id, device_id, key, value) values ($1, $2, 'ota_allowed', 'true')`, [T_A, D_B])), fk);
  await assert.rejects(as('app_api', T_A, (c) => c.query(
    `insert into app.address (tenant_id, client_id, address) values ($1, $2, 'x')`, [T_A, C_B])), fk);
  await assert.rejects(as('app_api', T_A, (c) => c.query(
    `insert into app.consumption_reset (tenant_id, device_id, by, water_total_l) values ($1, $2, $3, 1)`, [T_A, D_B, U_A])), fk);
  await assert.rejects(as('app_api', T_A, (c) => c.query(
    `insert into app.consumption_reset (tenant_id, device_id, by, water_total_l) values ($1, $2, $3, 1)`, [T_A, D_A, U_B])), fk);
  await assert.rejects(as('app_api', T_A, (c) => c.query(
    `select app.schedule_store_platform($1, 'Europe/Riga', 'w1,08:00,18:00;', $2)`, [D_B, U_A])), /нет устройства/);
  // Адрес устройства — того же клиента.
  await assert.rejects(as('app_api', T_A, async (c) => {
    const c2 = (await c.query(`insert into app.client (tenant_id, type, name) values ($1, 'person', 'A2') returning id`, [T_A])).rows[0].id;
    const a2 = (await c.query(`insert into app.address (tenant_id, client_id, address) values ($1, $2, 'адрес A2') returning id`, [T_A, c2])).rows[0].id;
    await c.query(`update app.device set address_id = $1 where id = $2`, [a2, D_A]); // клиент устройства — A1
  }), fk);
});

test('SIG Administrator: свои строки вне арендатора видны только в режиме global; арендаторам — нет', async () => {
  const SIG = 'cccccccc-0000-4000-8000-000000000001';
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into app.app_user (id, tenant_id, email, name, status) values ($1, null, 'sig@sig.example', 'SIG', 'active')`, [SIG]);
    await c.query(`insert into app.role_assignment (user_id, tenant_id, role) values ($1, null, 'sig_admin')`, [SIG]);
    await c.query('set local role app_api');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [T_A]);
    assert.equal((await c.query('select count(*)::int as n from app.app_user where id = $1', [SIG])).rows[0].n, 0);
    await c.query(`select set_config('app.tenant_id', '', true), set_config('app.scope', 'global', true)`);
    assert.equal((await c.query('select count(*)::int as n from app.app_user where id = $1', [SIG])).rows[0].n, 1);
    await c.query(`update app.app_user set failed_logins = 1 where id = $1`, [SIG]);
    // Создание арендатора и его первого Admin (§2).
    const T_N = '33333333-3333-4333-8333-333333333333';
    await c.query(`insert into app.tenant (id, name, code) values ($1, 'New', 'new')`, [T_N]);
    await c.query(`select set_config('app.tenant_id', $1, true)`, [T_N]);
    await c.query(`insert into app.app_user (tenant_id, email, name) values ($1, 'first@new.example', 'First')`, [T_N]);
    await c.query(`insert into app.audit_log (tenant_id, user_id, actor, action, object_type) values ($1, $2, 'user', 'tenant.create', 'tenant')`, [T_N, SIG]);
    // В режиме global чужие арендаторы по-прежнему закрыты, кроме текущего.
    assert.equal((await c.query('select count(*)::int as n from app.client')).rows[0].n, 0);
  } finally { await c.query('rollback'); c.release(); }
});

test('настройка: снять переопределение — снова действует унаследованное значение', async () => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role app_api');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [T_A]);
    assert.equal((await c.query(`delete from app.setting where device_id = $1 and key = 'ota_allowed'`, [D_A])).rowCount, 1);
    await assert.rejects(c.query(`insert into app.setting (tenant_id, key, value) values ($1, 'filter_warning_pct', 'null')`, [T_A]), /setting_value_ck/);
  } finally { await c.query('rollback'); c.release(); }
  // (после rollback строка вернулась; проверяем представление внутри транзакции владельца)
  const o = await pool.connect();
  try {
    await o.query('begin');
    await o.query(`delete from app.setting where device_id = $1 and key = 'ota_allowed'`, [D_A]);
    const r = (await o.query(`select value, level from app.v_device_setting where device_id = 'cooler-a1' and key = 'ota_allowed'`)).rows[0];
    assert.deepEqual(r, { value: false, level: 'platform' });
  } finally { await o.query('rollback'); o.release(); }
});

test('уникальность с логическим удалением: серийник удалённого устройства можно занять снова', async () => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`update app.device set deleted_at = now() where id = $1`, [D_A]);
    await c.query(`insert into app.device (tenant_id, device_id, serial, water_source, variant, carbonated) values ($1, 'cooler-a2', 'SN-1', 'mains', 'A', false)`, [T_A]);
    await assert.rejects(c.query(`insert into app.device (tenant_id, device_id, serial, water_source, variant, carbonated) values ($1, 'cooler-a3', 'SN-1', 'mains', 'A', false)`, [T_A]), /device_serial_uq/);
  } finally { await c.query('rollback'); c.release(); }
});

test('вход: поиск по e-mail, сессии и токену до выбора арендатора; сессии и токены — под RLS', async () => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into app.auth_session (id_hash, tenant_id, user_id, expires_at) values
      ('h1', $1, $2, now() + interval '1 hour'), ('h2', $1, $2, now() - interval '1 second'),
      ('hb', $3, $4, now() + interval '1 hour')`, [T_A, U_A, T_B, U_B]);
    await c.query(`insert into app.auth_token (token_hash, tenant_id, kind, user_id, expires_at) values
      ('t1', $1, 'invitation', $2, now() + interval '72 hours'), ('tb', $3, 'password_reset', $4, now() + interval '1 hour')`, [T_A, U_A, T_B, U_B]);
    await c.query('set local role app_api');
    const r = (await c.query(`select * from app.auth_lookup_email('admin@VENDEN.lv')`)).rows;
    assert.equal(r.length, 1);
    assert.equal(r[0].tenant_id, T_A);
    assert.equal(r[0].role, 'admin');
    assert.equal((await c.query(`select * from app.auth_lookup_session('h1')`)).rows[0].user_id, U_A);
    assert.equal((await c.query(`select * from app.auth_lookup_session('h2')`)).rows.length, 0); // истекла
    assert.equal((await c.query(`select * from app.auth_lookup_token('t1')`)).rows[0].kind, 'invitation');
    // Сам арендатор A чужих сессий и токенов не видит и не меняет.
    await c.query(`select set_config('app.tenant_id', $1, true)`, [T_A]);
    assert.deepEqual((await c.query('select id_hash from app.auth_session order by 1')).rows.map((x) => x.id_hash), ['h1', 'h2']);
    assert.deepEqual((await c.query('select token_hash from app.auth_token')).rows.map((x) => x.token_hash), ['t1']);
    assert.equal((await c.query(`update app.auth_session set revoked_at = now() where id_hash = 'hb'`)).rowCount, 0);
  } finally { await c.query('rollback'); c.release(); }
  await assert.rejects(as('app_device', null, (c) => c.query(`select * from app.auth_lookup_email('x')`)), denied);
});

test('app_device: таблицы app закрыты, видны только представления — по всем арендаторам', async () => {
  for (const t of ['device', 'client', 'app_user', 'audit_log', 'schedule_version', 'setting']) {
    await assert.rejects(as('app_device', null, (c) => c.query(`select 1 from app.${t} limit 1`)), denied, t);
  }
  await assert.rejects(as('app_device', null, (c) => c.query(`insert into app.audit_log (actor, action, object_type) values ('ingest', 'a.b', 'x')`)), denied);
  await as('app_device', null, async (c) => {
    const d = (await c.query('select device_id, tenant_id, blocked from app.v_device order by device_id')).rows;
    assert.deepEqual(d, [{ device_id: 'cooler-a1', tenant_id: T_A, blocked: false }, { device_id: 'cooler-b1', tenant_id: T_B, blocked: false }]);
    const s = Object.fromEntries((await c.query(`select key, value, level from app.v_device_setting where device_id = 'cooler-a1'`)).rows.map((r) => [r.key, r]));
    assert.deepEqual(s['ota_allowed'], { key: 'ota_allowed', value: true, level: 'device' });
    assert.deepEqual(s['offline_alert_after_min'], { key: 'offline_alert_after_min', value: 30, level: 'tenant' });
    assert.deepEqual(s['timezone'], { key: 'timezone', value: 'Europe/Riga', level: 'platform' });
    const b = (await c.query(`select value from app.v_device_setting where device_id = 'cooler-b1' and key = 'ota_allowed'`)).rows[0];
    assert.equal(b.value, false); // FW-7: по умолчанию выключено
  });
});

test('audit_append: службы Устройства пишут аудит; чужая служба и плохое действие — отказ', async () => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role app_device');
    const id = (await c.query(`select app.audit_append($1, 'provisioning', 'certificate.rotate', 'device', $2, null, '{"thumbprint":"ab"}')`, [T_A, D_A])).rows[0].audit_append;
    assert.match(id, /^[0-9a-f-]{36}$/);
    await c.query('reset role');
    const row = (await c.query('select tenant_id, actor, action, user_id from app.audit_log where id = $1', [id])).rows[0];
    assert.deepEqual(row, { tenant_id: T_A, actor: 'provisioning', action: 'certificate.rotate', user_id: null });
  } finally { await c.query('rollback'); c.release(); }
  await assert.rejects(as('app_device', null, (c) => c.query(`select app.audit_append($1, 'api', 'user.block', 'user', null)`, [T_A])), /не из дорожки/);
  await assert.rejects(as('app_device', null, (c) => c.query(`select app.audit_append($1, 'dispatcher', 'retry', 'command', null)`, [T_A])), /object\.verb/);
});

test('schedule_store_local: новая версия «изменено на месте», повтор события — без новой версии, аудит', async () => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into app.schedule_version (tenant_id, device_id, version, timezone, content, source, changed_at)
      values ($1, $2, 1, 'Europe/Riga', 'w1,08:00,18:00;', 'platform', '2026-12-01T10:00:00Z')`, [T_A, D_A]);
    await c.query('set local role app_device');
    const call = (lv: string, at: string, content = 'w1,07:00,20:00;') =>
      c.query(`select app.schedule_store_local('cooler-a1', $1, $2, $3) as v`, [content, lv, at]).then((r) => r.rows[0].v as number);
    assert.equal(await call('local:2026-12-02T09:00:00Z', '2026-12-02T09:00:00Z'), 2);
    assert.equal(await call('local:2026-12-02T09:00:00Z', '2026-12-02T09:00:00Z'), 2); // повтор
    const cur = (await c.query(`select version, source, timezone, content, local_version from app.v_device_schedule where device_id = 'cooler-a1'`)).rows[0];
    assert.deepEqual(cur, { version: 2, source: 'local', timezone: 'Europe/Riga', content: 'w1,07:00,20:00;', local_version: 'local:2026-12-02T09:00:00Z' });
    await c.query('reset role');
    assert.equal((await c.query(`select count(*)::int as n from app.schedule_version where device_id = $1`, [D_A])).rows[0].n, 2);
    assert.equal((await c.query(`select count(*)::int as n from app.audit_log where action = 'schedule.store_local'`)).rows[0].n, 1);
  } finally { await c.query('rollback'); c.release(); }
});

test('schedule_store_local: конфликт — действует более позднее изменение, другое остаётся в истории', async () => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    // Платформа изменила расписание 05.12, а на месте меняли раньше — 03.12, пока кулер был без связи.
    await c.query(`insert into app.schedule_version (tenant_id, device_id, version, timezone, content, source, changed_at)
      values ($1, $2, 1, 'Europe/Riga', 'w1,08:00,18:00;', 'platform', '2026-12-05T10:00:00Z')`, [T_A, D_A]);
    await c.query('set local role app_device');
    const v = (await c.query(`select app.schedule_store_local('cooler-a1', 'w2,09:00,17:00;', 'local:2026-12-03T09:00:00Z', '2026-12-03T09:00:00Z') as v`)).rows[0].v;
    assert.equal(v, 1, 'действует более позднее изменение платформы');
    const cur = (await c.query(`select version, source from app.v_device_schedule where device_id = 'cooler-a1'`)).rows[0];
    assert.deepEqual(cur, { version: 1, source: 'platform' });
    // Изменение на месте позже платформы — действует оно.
    const v2 = (await c.query(`select app.schedule_store_local('cooler-a1', 'w3,09:00,17:00;', 'local:2026-12-06T09:00:00Z', '2026-12-06T09:00:00Z', 'Europe/Vilnius') as v`)).rows[0].v;
    assert.equal(v2, 3);
    const cur2 = (await c.query(`select version, source, timezone from app.v_device_schedule where device_id = 'cooler-a1'`)).rows[0];
    assert.deepEqual(cur2, { version: 3, source: 'local', timezone: 'Europe/Vilnius' });
  } finally { await c.query('rollback'); c.release(); }
});

test('schedule_store_local: не дошёл schedversion — то же содержимое и пояс, новой версии нет', async () => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role app_api');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [T_A]);
    const v = (await c.query(`select app.schedule_store_platform($1, 'Europe/Riga', 'w1,08:00,18:00;', $2) as v`, [D_A, U_A])).rows[0].v;
    assert.equal(v, 1);
    await c.query('reset role');
    await c.query('set local role app_device');
    const r = (await c.query(`select app.schedule_store_local('cooler-a1', 'w1,08:00,18:00;', 'local:2026-12-07T09:00:00Z', '2026-12-07T09:00:00Z') as v`)).rows[0].v;
    assert.equal(r, 1);
    await c.query('reset role');
    assert.equal((await c.query(`select count(*)::int as n from app.schedule_version where device_id = $1`, [D_A])).rows[0].n, 1);
    assert.equal((await c.query(`select count(*)::int as n from app.audit_log where action = 'schedule.store_local'`)).rows[0].n, 0);
  } finally { await c.query('rollback'); c.release(); }
});

test('schedule_store_local: повтор совпавшего сообщения после нового изменения платформы — без новой версии и аудита', async () => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role app_api');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [T_A]);
    await c.query(`select app.schedule_store_platform($1, 'Europe/Riga', 'w1,08:00,18:00;', $2)`, [D_A, U_A]);
    await c.query('reset role');
    await c.query('set local role app_device');
    const L = 'local:2026-12-07T09:00:00Z';
    const call = () => c.query(`select app.schedule_store_local('cooler-a1', 'w1,08:00,18:00;', $1, '2026-12-07T09:00:00Z') as v`, [L]).then((r) => r.rows[0].v);
    assert.equal(await call(), 1); // совпало с v1 — не дошёл schedversion
    await c.query('reset role');
    await c.query('set local role app_api');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [T_A]);
    assert.equal((await c.query(`select app.schedule_store_platform($1, 'Europe/Riga', 'w2,08:00,18:00;', $2) as v`, [D_A, U_A])).rows[0].v, 2);
    await c.query('reset role');
    await c.query('set local role app_device');
    assert.equal(await call(), 2); // повтор L: действует v2, новой версии нет
    await c.query('reset role');
    assert.equal((await c.query(`select count(*)::int as n from app.schedule_version where device_id = $1`, [D_A])).rows[0].n, 2);
    assert.equal((await c.query(`select count(*)::int as n from app.audit_log where action = 'schedule.store_local'`)).rows[0].n, 0);
  } finally { await c.query('rollback'); c.release(); }
});

test('пустое расписание сохраняется обоими путями; «;;» — нет', async () => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role app_api');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [T_A]);
    assert.equal((await c.query(`select app.schedule_store_platform($1, 'Europe/Riga', '', $2) as v`, [D_A, U_A])).rows[0].v, 1);
    await c.query('reset role');
    await c.query('set local role app_device');
    assert.equal((await c.query(`select app.schedule_store_local('cooler-a1', 'w1,08:00,18:00;', 'local:2026-12-07T09:00:00Z', now()) as v`)).rows[0].v, 2);
    assert.equal((await c.query(`select app.schedule_store_local('cooler-a1', '', 'local:2026-12-07T10:00:00Z', now() + interval '1 second') as v`)).rows[0].v, 3);
  } finally { await c.query('rollback'); c.release(); }
  await assert.rejects(as('app_api', T_A, (c) => c.query(`select app.schedule_store_platform($1, 'Europe/Riga', 'w1,08:00,18:00;;', $2)`, [D_A, U_A])), /autopowerscheduling/);
  await assert.rejects(as('app_api', T_A, (c) => c.query(`select app.schedule_store_platform($1, 'Europe/Riga', ';', $2)`, [D_A, U_A])), /autopowerscheduling/);
});

test('версии расписания: платформа и устройство одновременно — разные номера, без ошибки', async () => {
  const tx1 = await pool.connect();
  const tx2 = await pool.connect();
  try {
    await tx1.query('begin');
    await tx1.query('set local role app_api');
    await tx1.query(`select set_config('app.tenant_id', $1, true)`, [T_A]);
    const v1 = (await tx1.query(`select app.schedule_store_platform($1, 'Europe/Riga', 'w1,08:00,18:00;', $2) as v`, [D_A, U_A])).rows[0].v;
    await tx2.query('begin');
    await tx2.query('set local role app_device');
    const p2 = tx2.query(`select app.schedule_store_local('cooler-a1', 'w2,08:00,18:00;', 'local:2026-12-07T09:00:00Z', now() + interval '1 minute') as v`);
    await new Promise((r) => setTimeout(r, 300)); // tx2 ждёт блокировку устройства
    await tx1.query('commit');
    const v2 = (await p2).rows[0].v;
    await tx2.query('commit');
    assert.equal(v1, 1);
    assert.equal(v2, 2);
  } finally {
    tx1.release(); tx2.release();
    await owner(`alter table app.audit_log disable trigger audit_log_append_only`);
    await owner(`delete from app.audit_log where action = 'schedule.store_local'`);
    await owner(`alter table app.audit_log enable trigger audit_log_append_only`);
    await owner(`delete from app.schedule_local_report where device_id = $1`, [D_A]);
    await owner(`delete from app.schedule_version where device_id = $1`, [D_A]);
  }
});

test('версии расписания: устройство первым, платформа одновременно — разные номера, без ошибки', async () => {
  const tx1 = await pool.connect();
  const tx2 = await pool.connect();
  try {
    await tx1.query('begin');
    await tx1.query('set local role app_device');
    const v1 = (await tx1.query(`select app.schedule_store_local('cooler-a1', 'w2,08:00,18:00;', 'local:2026-12-07T09:00:00Z', now() - interval '1 minute') as v`)).rows[0].v;
    await tx2.query('begin');
    await tx2.query('set local role app_api');
    await tx2.query(`select set_config('app.tenant_id', $1, true)`, [T_A]);
    const p2 = tx2.query(`select app.schedule_store_platform($1, 'Europe/Riga', 'w1,08:00,18:00;', $2) as v`, [D_A, U_A]);
    await new Promise((r) => setTimeout(r, 300));
    await tx1.query('commit');
    const v2 = (await p2).rows[0].v;
    await tx2.query('commit');
    assert.equal(v1, 1);
    assert.equal(v2, 2);
  } finally {
    tx1.release(); tx2.release();
    await owner(`alter table app.audit_log disable trigger audit_log_append_only`);
    await owner(`delete from app.audit_log where action = 'schedule.store_local'`);
    await owner(`alter table app.audit_log enable trigger audit_log_append_only`);
    await owner(`delete from app.schedule_local_report where device_id = $1`, [D_A]);
    await owner(`delete from app.schedule_version where device_id = $1`, [D_A]);
  }
});

test('расписание и пояс проверяются: часы, повторы, порядок, формат версии, IANA', async () => {
  const bad: [string, string, RegExp][] = [
    ['w1,29:00,18:00;', 'Europe/Riga', /autopowerscheduling/],
    ['w1,08:00,18:00;w1,09:00,10:00;', 'Europe/Riga', /одного окна/],
    ['f0,10,20;f0,30,40;', 'Europe/Riga', /повторяется/],
    ['f0,20,10;', 'Europe/Riga', /не раньше конца/],
    ['w1,08:00,18:00', 'Europe/Riga', /autopowerscheduling/],
    ['w1,08:00,18:00;', 'Mars/Phobos', /не IANA/],
  ];
  for (const [content, tz, re] of bad) {
    await assert.rejects(as('app_api', T_A, (c) => c.query(`select app.schedule_store_platform($1, $2, $3, $4)`, [D_A, tz, content, U_A])), re, content + ' ' + tz);
    await assert.rejects(as('app_device', null, (c) => c.query(`select app.schedule_store_local('cooler-a1', $1, 'local:2026-12-07T09:00:00Z', now(), $2)`, [content, tz])), re, 'local ' + content);
  }
  for (const lv of ['local:2026-99-99T00:00:00Z', 'local:2026-12-07Tgarbage', 'local:2026-02-30T10:00:00Z']) {
    await assert.rejects(as('app_device', null, (c) => c.query(`select app.schedule_store_local('cooler-a1', 'w1,08:00,18:00;', $1, now())`, [lv])), /local:|нет такого/, lv);
  }
  await as('app_api', T_A, async (c) => {
    await assert.rejects(c.query(`insert into app.schedule_version (tenant_id, device_id, version, timezone, content, source, changed_at)
      values ($1, $2, 9, 'Europe/Riga', '', 'platform', now())`, [T_A, D_A]), denied);
  });
});

test('schedule_store_local: неизвестное устройство и неверные данные — отказ', async () => {
  await assert.rejects(as('app_device', null, (c) => c.query(`select app.schedule_store_local('nope', 'w1,08:00,18:00;', 'local:2026-12-02T09:00:00Z', now())`)), /нет устройства/);
  await assert.rejects(as('app_device', null, (c) => c.query(`select app.schedule_store_local('cooler-a1', 'не расписание', 'local:2026-12-02T09:00:00Z', now())`)), /autopowerscheduling/);
  await assert.rejects(as('app_device', null, (c) => c.query(`select app.schedule_store_local('cooler-a1', 'w1,08:00,18:00;', '12', now())`)), /local:/);
});

test('контракт contracts/db/app-interface.json совпадает с базой, прочих прав у app_device нет', async () => {
  const spec = JSON.parse(readFileSync(join(repoRoot(), 'contracts/db/app-interface.json'), 'utf8'));
  const cols = (await owner(`
    select c.relname as v, a.attname as col, format_type(a.atttypid, a.atttypmod) as type
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'v' and a.attnum > 0 order by c.relname, a.attnum`)).rows;
  const views: Record<string, Record<string, string>> = {};
  for (const r of cols) (views[r.v] ??= {})[r.col] = r.type;
  assert.deepEqual(Object.keys(views).sort(), Object.keys(spec.views).sort());
  for (const [v, s] of Object.entries<{ columns: Record<string, string> }>(spec.views)) assert.deepEqual(views[v], s.columns, v);
  for (const [f, s] of Object.entries<{ arguments: string; returns: string }>(spec.functions)) {
    const r = (await owner(`select pg_get_function_arguments(p.oid) as a, pg_get_function_result(p.oid) as r
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = $1`, [f])).rows;
    assert.deepEqual(r, [{ a: s.arguments, r: s.returns }], f);
  }
  // Всё, что app_device может в схеме app, — ровно объекты контракта.
  const tables = (await owner(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'v', 'm')
      and (has_table_privilege('app_device', c.oid, 'SELECT') or has_table_privilege('app_device', c.oid, 'INSERT')
        or has_table_privilege('app_device', c.oid, 'UPDATE') or has_table_privilege('app_device', c.oid, 'DELETE'))
    order by 1`)).rows.map((r) => r.relname);
  assert.deepEqual(tables, Object.keys(spec.views).sort());
  const fns = (await owner(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and has_function_privilege('app_device', p.oid, 'EXECUTE') order by 1`)).rows.map((r) => r.proname);
  assert.deepEqual(fns, Object.keys(spec.functions).sort());
  const writable = (await owner(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'v'
      and (has_table_privilege('app_device', c.oid, 'INSERT') or has_table_privilege('app_device', c.oid, 'UPDATE')
        or has_table_privilege('app_device', c.oid, 'DELETE') or has_table_privilege('app_device', c.oid, 'TRUNCATE'))`)).rows;
  assert.deepEqual(writable, []);
});
