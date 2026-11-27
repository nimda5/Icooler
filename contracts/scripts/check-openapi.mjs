// Тест OpenAPI (contracts/openapi/openapi.yaml) против ТЗ Stage 1: матрица прав 7.1, правила ответов,
// границы портала End User (7.5) и связь с командами 7.3 (schemas/command.schema.json).
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const doc = parse(read('openapi/openapi.yaml'));
const matrix = JSON.parse(read('openapi/roles-matrix.json'));
const command = JSON.parse(read('schemas/command.schema.json'));

let failed = 0;
const fail = (m) => { failed++; console.error(`✗ ${m}`); };
const ROLES = ['admin', 'tech', 'exec', 'dispatcher', 'end_user', 'sig_admin'];
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const ops = new Map();
for (const [path, item] of Object.entries(doc.paths)) {
  for (const m of METHODS) if (item[m]) ops.set(item[m].operationId, { path, method: m, op: item[m], params: [...(item.parameters ?? []), ...(item[m].parameters ?? [])] });
}

// 1. Матрица 7.1: у каждой операции — строка, x-roles = роли из клеток строки.
const placed = new Map();
const place = (id, row) => {
  if (placed.has(id) && !id.startsWith('eu')) fail(`${id}: в двух строках матрицы — «${placed.get(id)}» и «${row.action}»`);
  placed.set(id, row.action);
};
for (const row of matrix.rows) {
  const allowed = (kind) => ROLES.filter((r) => r !== 'end_user' && (row.cells[r] === '✅' || (kind === 'view' && row.cells[r] === '👁')));
  for (const kind of ['view', 'change']) {
    for (const id of row[kind] ?? []) {
      place(id, row);
      const o = ops.get(id);
      if (!o) { fail(`матрица «${row.action}»: нет операции ${id}`); continue; }
      const got = [...o.op['x-roles']].sort().join(',');
      const want = allowed(kind).sort().join(',');
      if (got !== want) fail(`${id}: x-roles [${got}], по матрице «${row.action}» (${kind}) — [${want}]`);
      if (kind === 'view' && o.method !== 'get' && id !== 'markNotificationsRead') fail(`${id}: view-операция не GET`);
    }
  }
  for (const id of row.any ?? []) { place(id, row); if (ops.get(id)?.op['x-roles'].join() !== 'any') fail(`${id}: ожидалось x-roles [any]`); }
  for (const id of row.public ?? []) { place(id, row); if (ops.get(id)?.op['x-roles'].join() !== 'public') fail(`${id}: ожидалось x-roles [public]`); }
  const eu = row.eu_operations ?? [];
  const own = !!row.cells && row.cells.end_user !== '✗' && row.cells.end_user !== '✅';
  if (own !== eu.length > 0) fail(`матрица «${row.action}»: у End User «${row.cells?.end_user}», eu-операций ${eu.length}`);
  for (const id of eu) {
    place(id, row);
    const o = ops.get(id);
    if (!o) { fail(`матрица «${row.action}»: нет операции ${id}`); continue; }
    if (o.op['x-roles'].join() !== 'end_user') fail(`${id}: eu-операция с x-roles [${o.op['x-roles']}]`);
  }
}
for (const id of ops.keys()) if (!placed.has(id)) fail(`${id}: операции нет в матрице 7.1 (openapi/roles-matrix.json)`);

// 2. Пространства: /eu — только End User; прочее End User недоступно.
for (const [id, { path, op }] of ops) {
  const r = op['x-roles'];
  if (!Array.isArray(r) || !r.length) { fail(`${id}: нет x-roles`); continue; }
  for (const x of r) if (![...ROLES, 'any', 'public'].includes(x)) fail(`${id}: неизвестная роль ${x}`);
  if (path.startsWith('/eu/') !== r.includes('end_user')) fail(`${id}: End User ${r.includes('end_user') ? 'вне' : 'без'} /eu`);
}

// 3. Ответы: 401 при сессии, 403 при ограничении ролей, 404 у пути с идентификатором, 428 у двойного подтверждения, 429 везде.
for (const [id, o] of ops) {
  const { path, op, params } = o;
  const has = (c) => c in op.responses;
  const r = op['x-roles'];
  const pub = r.includes('public');
  if (pub !== (Array.isArray(op.security) && op.security.length === 0)) fail(`${id}: public и security не согласованы`);
  if (!pub && !has('401')) fail(`${id}: нет 401`);
  if (!pub && !has('403')) fail(`${id}: нет 403 (роль или CSRF)`);
  const csrf = params.some((p) => p.$ref?.endsWith('/CsrfToken'));
  if (!pub && o.method !== 'get' && !csrf) fail(`${id}: изменяющий запрос без X-CSRF-Token`);
  if (path.includes('{') && !has('404')) fail(`${id}: нет 404 (чужое — 404, 7.1)`);
  if (!has('429')) fail(`${id}: нет 429 (лимиты 7.4)`);
  const success = Object.keys(op.responses).filter((c) => c.startsWith('2'));
  if (success.length !== 1) fail(`${id}: успешных ответов ${success.length}`);
  const body = op.requestBody?.content?.['application/json']?.schema?.$ref?.split('/').pop();
  const confirmBody = body === 'Confirm' || body === 'SwitchConfirm';
  if (has('428') !== confirmBody) fail(`${id}: 428 и тело с confirm не согласованы (тело ${body ?? 'нет'})`);
  if (op['x-commands'] && !params.some((p) => p.$ref?.endsWith('/IdempotencyKey')) && !['resetConsumption', 'euResetConsumption'].includes(id)) {
    fail(`${id}: команда без Idempotency-Key`);
  }
}
// Выключение и сбросы — с двойным подтверждением (V-108).
for (const id of ['setHeating', 'setCooling', 'setPower', 'resetFilter', 'resetConsumption', 'blockDevice',
  'euSetHeating', 'euSetCooling', 'euSetPower', 'euResetFilter', 'euResetConsumption']) {
  if (!ops.get(id) || !('428' in ops.get(id).op.responses)) fail(`${id}: нет двойного подтверждения (428, V-108)`);
}

// 4. End User не видит журналы команд и ошибок, eSIM, технические параметры (7.5) — по всем вложенным схемам.
const schemas = doc.components.schemas;
const closure = (start) => {
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/components/schemas/')) {
      const n = node.$ref.split('/').pop();
      if (!seen.has(n)) { seen.add(n); walk(schemas[n]); }
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(start);
  return seen;
};
const FORBIDDEN_EU = ['Command', 'CommandPage', 'ErrorEntry', 'ErrorEntryPage', 'EsimProfile', 'EsimOperation', 'DeviceState',
  'DeviceCard', 'Device', 'DeviceEvent', 'TelemetrySeries', 'AuditEntry', 'Alert'];
for (const [id, { path, op }] of ops) {
  if (!path.startsWith('/eu/')) continue;
  const used = closure(op.responses);
  for (const f of FORBIDDEN_EU) if (used.has(f)) fail(`${id}: End User получает схему ${f} (7.5)`);
}

// 4б. Состав ответов End User — только разрешённые поля (по всем вложенным схемам и inline-полям).
const EU_FIELDS = new Set(['items', 'next_cursor', 'id', 'name', 'client_id', 'device_id', 'address', 'floor', 'place', 'status',
  'filter_left_pct', 'heat_on', 'cool_on', 'heat_enabled', 'cool_enabled', 'power_on', 'energy_saving', 'not_running_reason',
  'consumption_month_l', 'since_reset_l', 'last_reset_at', 'from', 'to', 'bucket', 'total_l', 'source', 'points', 't', 'liters',
  'type', 'opened_at', 'action', 'created_at', 'outcome', 'filter', 'command_id', 'installed_at', 'installed_by', 'nominal_l',
  'used_l', 'left_pct', 'forecast_at', 'replace_by', 'level', 'at', 'by', 'water_total_l', 'current', 'delivery',
  'device_version', 'timezone', 'windows', 'holidays', 'day', 'start', 'end', 'version', 'created_by']);
const props = (node, out = new Set(), seen = new Set()) => {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.$ref === 'string') {
    const n = node.$ref.split('/').pop();
    if (!seen.has(n)) { seen.add(n); props(schemas[n], out, seen); }
    // соседние с $ref ключи (OpenAPI 3.1) тоже действуют — обходим ниже
  }
  if (node.properties) for (const k of Object.keys(node.properties)) out.add(k);
  for (const v of Object.values(node)) props(v, out, seen);
  return out;
};
// Регрессия: поле рядом с $ref должно ловиться.
if (!props({ $ref: '#/components/schemas/EuDevice', properties: { t_hot: {} } }).has('t_hot')) fail('проверка полей End User не видит поля рядом с $ref');
for (const [id, { path, op }] of ops) {
  if (!path.startsWith('/eu/')) continue;
  for (const [code, r] of Object.entries(op.responses)) {
    if (!code.startsWith('2')) continue;
    for (const k of props(r)) if (!EU_FIELDS.has(k)) fail(`${id}: в ответе End User поле «${k}» вне разрешённых (7.5)`);
  }
}
const euAlertTypes = schemas.EuAlertList.properties.items.items.properties.type.enum;
for (const t of euAlertTypes) if (!['offline', 'filter_low', 'filter_expired'].includes(t)) fail(`EuAlertList: тип ${t} — End User видит только фильтр и офлайн (7.1)`);

// 4в. Невыполнимая композиция: allOf с членом additionalProperties:false и полями в других членах.
for (const [n, sch] of Object.entries(schemas)) {
  const members = sch.allOf ?? [];
  const closed = members.some((m) => (m.$ref ? schemas[m.$ref.split('/').pop()] : m)?.additionalProperties === false);
  if (closed && members.length > 1) fail(`${n}: allOf со схемой additionalProperties:false — лишние поля запрещены (используйте unevaluatedProperties)`);
}

// 4г. Настройки 7.4: запись — закрытый список ключей с границами, каждый ключ чтения можно записать.
const sw = schemas.SettingsWrite, sr = schemas.Settings;
if (sw.additionalProperties !== false) fail('SettingsWrite: разрешены произвольные ключи');
for (const k of Object.keys(sr.properties)) if (!sw.properties[k]) fail(`SettingsWrite: нет ключа ${k}`);
for (const [k, v] of Object.entries(sw.properties)) if (v.minimum === undefined || v.maximum === undefined) fail(`SettingsWrite.${k}: нет границ`);

// 4д. Примеры: каждый пример проходит свою схему; у основных схем ответа пример есть.
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const rewrite = (x) => JSON.parse(JSON.stringify(x).replaceAll('#/components/schemas/', 'oas#/$defs/'));
ajv.addSchema({ $id: 'oas', $defs: rewrite(schemas) });
const exDir = new URL('openapi/examples/', root);
const examples = readdirSync(exDir).filter((f) => f.endsWith('.json'));
for (const f of examples) {
  const [name, kind] = f.replace('.json', '').split('--');
  if (!schemas[name]) { fail(`пример ${f}: нет схемы ${name}`); continue; }
  const v = ajv.getSchema(`oas#/$defs/${name}`);
  const ok = v(JSON.parse(readFileSync(new URL(f, exDir), 'utf8')));
  const want = !kind.startsWith('invalid');
  if (ok !== want) fail(`пример ${f}: ожидалось ${want ? 'пройти' : 'не пройти'} ${name}${ok ? '' : ': ' + JSON.stringify(v.errors)}`);
}
// Смысл примеров: итог потребления = сумма точек.
for (const f of examples.filter((x) => /^Consumption--/.test(x) && !x.includes('--invalid'))) {
  const c = JSON.parse(readFileSync(new URL(f, exDir), 'utf8'));
  const sum = Math.round(c.points.reduce((a, p) => a + p.liters, 0) * 100) / 100;
  if (Math.abs(sum - c.total_l) > 0.01) fail(`пример ${f}: total_l ${c.total_l}, сумма точек ${sum}`);
}
// Экспорт списка устройств принимает те же фильтры, что список.
const qnames = (id) => new Set(ops.get(id).params.map((p) => p.name ?? p.$ref.split('/').pop()));
for (const q of qnames('listDevices')) if (!['Limit', 'Cursor'].includes(q) && !qnames('exportDevices').has(q)) fail(`exportDevices: нет фильтра ${q} из listDevices`);
const MUST_EXAMPLE = ['Session', 'User', 'EndUser', 'Client', 'ClientWrite', 'ClientCard', 'Address', 'AddressWrite', 'Contact',
  'ContactWrite', 'Device', 'DeviceCard', 'DeviceCreate', 'Command', 'EuCommand', 'ScheduleWrite', 'ScheduleState',
  'Consumption', 'Filter', 'Reset', 'Alert', 'EsimProfile', 'EsimProfileWrite', 'EsimOperation', 'Settings', 'SettingsWrite',
  'Dashboard', 'MapView', 'EuDevice', 'EuDeviceList', 'EuAlertList', 'CertificateState', 'Problem', 'ImportReport'];
for (const n of MUST_EXAMPLE) if (!examples.some((f) => f.startsWith(`${n}--`) && !f.includes('--invalid'))) fail(`нет примера схемы ${n}`);

// 5. Связь с командами 7.3: каждая команда Stage 1 из command.schema.json создаётся какой-то операцией или
//    служебно отправляется dispatcher; операций с командами вне Stage 1 нет.
const stage1 = new Set();
for (const branch of command.oneOf ?? []) {
  const p = branch.properties ?? {};
  const opv = p.op?.const;
  const params = p.param?.const !== undefined ? [p.param.const] : p.param?.enum ?? [];
  for (const x of params) if (opv) stage1.add(`${opv} ${x}`);
}
if (stage1.size < 10) fail(`не удалось прочитать команды из command.schema.json (${stage1.size})`);
const SERVICE = new Set(['GET schedversion', 'GET timezone', 'GET otaallowed']); // dispatcher сверяет версии и настройки
const viaApi = new Set();
for (const [id, { op }] of ops) {
  for (const c of op['x-commands'] ?? []) {
    const k = `${c.op} ${c.param}`;
    viaApi.add(k);
    if (!stage1.has(k)) fail(`${id}: команда ${k} не из Stage 1 (command.schema.json)`);
  }
}
for (const k of stage1) if (!viaApi.has(k) && !SERVICE.has(k)) fail(`команда ${k} не создаётся ни одной операцией API`);

console.log(failed ? `Ошибок OpenAPI: ${failed}` : `OK: OpenAPI — ${ops.size} операций, матрица 7.1 (${matrix.rows.length} строк), границы End User, команды 7.3, ${examples.length} примеров`);
process.exit(failed ? 1 : 0);
