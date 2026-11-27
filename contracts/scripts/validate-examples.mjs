// Тест контрактов (ТЗ Stage 1 §7.3).
// 1. Каждая схема компилируется в строгом режиме ajv (strictRequired выключен: required в if/not без properties).
// 2. Правильные примеры проходят схему и смысловые проверки (semantics.mjs).
// 3. Неправильные отклоняются, и каждый изолирован: отличается от своего правильного «базового» примера
//    только в заявленных местах (examples/invalid.expect.json) — значит, отклонён именно по ним.
// 4. Покрытие: каждая команда Stage 1, каждый тип события и вид результата имеют правильный пример;
//    запрещённые команды существующей прошивки — неправильный.
// Пример относится к схеме по префиксу имени: <схема>--<случай>.json.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { semanticErrors } from './semantics.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

const schemaDir = join(root, 'schemas');
const schemaFiles = readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json'));
for (const f of schemaFiles) ajv.addSchema(read(join(schemaDir, f)), f);
const validators = {};
for (const f of schemaFiles) {
  const name = f.replace('.schema.json', '');
  if (name !== 'common') validators[name] = ajv.getSchema(f);
}

let failed = 0;
const fail = (msg) => { failed++; console.error(`✗ ${msg}`); };

const load = (kind) => {
  const dir = join(root, 'examples', kind);
  return Object.fromEntries(readdirSync(dir).filter((x) => x.endsWith('.json')).sort()
    .map((f) => [f.replace(/\.json$/, ''), read(join(dir, f))]));
};
const examples = { valid: load('valid'), invalid: load('invalid') };

function check(name, msg) {
  const schemaName = name.split('--')[0];
  const validate = validators[schemaName];
  if (!validate) return { error: `нет схемы «${schemaName}»` };
  if (!validate(msg)) return { ok: false, why: validate.errors };
  const sem = semanticErrors(schemaName, msg);
  return sem.length ? { ok: false, why: sem } : { ok: true };
}

for (const [kind, set] of Object.entries(examples)) {
  for (const [name, msg] of Object.entries(set)) {
    const r = check(name, msg);
    if (r.error) { fail(`${kind}/${name}: ${r.error}`); continue; }
    if (r.ok !== (kind === 'valid')) {
      fail(`${kind}/${name}: ожидалось ${kind === 'valid' ? 'принять' : 'отклонить'}`);
      if (r.why) console.error(JSON.stringify(r.why, null, 2));
    }
  }
}

// Изоляция неправильных примеров.
const leaves = (o, p = '') => (o !== null && typeof o === 'object' && !Array.isArray(o)
  ? Object.entries(o).flatMap(([k, v]) => leaves(v, `${p}/${k}`))
  : [[p, o]]);
const expect = read(join(root, 'examples', 'invalid.expect.json'));
for (const name of Object.keys(examples.invalid)) {
  const e = expect[name];
  if (!e) { fail(`invalid/${name}: нет записи в invalid.expect.json`); continue; }
  const base = examples.valid[e.base];
  if (!base) { fail(`invalid/${name}: нет базового примера valid/${e.base}`); continue; }
  if (name.split('--')[0] !== e.base.split('--')[0]) fail(`invalid/${name}: базовый пример другой схемы`);
  const a = new Map(leaves(base));
  const b = new Map(leaves(examples.invalid[name]));
  const diff = [...new Set([...a.keys(), ...b.keys()])]
    .filter((k) => !(a.has(k) && b.has(k) && isDeepStrictEqual(a.get(k), b.get(k))));
  const stray = diff.filter((k) => !e.changed.some((c) => k === c || k.startsWith(`${c}/`)));
  if (!diff.length) fail(`invalid/${name}: не отличается от valid/${e.base}`);
  if (stray.length) fail(`invalid/${name}: лишние отличия от valid/${e.base}: ${stray.join(', ')}`);
}
for (const name of Object.keys(expect)) if (!examples.invalid[name]) fail(`invalid.expect.json: нет примера ${name}`);

// Покрытие.
const has = (set, schema, pred) => Object.entries(examples[set]).some(([n, m]) => n.startsWith(`${schema}--`) && pred(m));
const stage1 = [
  ['GET', 'all'], ['GET', 'schedversion'], ['GET', 'timezone'], ['GET', 'otaallowed'],
  ...['hottank', 'coldtank', 'power', 'energysaving', 'otaallowed'].flatMap((p) => [['POST', p, '0'], ['POST', p, '1']]),
  ['POST', 'filterreset', '1'], ['POST', 'selftest', '1'],
  ['POST', 'autopowerscheduling'], ['POST', 'schedversion'], ['POST', 'timezone'],
];
for (const [op, param, value] of stage1) {
  if (!has('valid', 'command', (m) => m.op === op && m.param === param && (value === undefined || m.value === value))) {
    fail(`покрытие: нет правильного примера команды ${op} ${param}${value !== undefined ? `:${value}` : ''}`);
  }
}
for (const param of ['pin', 'serial', 'datetime', 'factoryreset']) {
  if (!has('invalid', 'command', (m) => m.param === param)) fail(`покрытие: нет примера запрещённой команды ${param}`);
}
const eventTypes = ajv.getSchema('event.schema.json').schema.properties.type.enum;
for (const t of eventTypes) if (!has('valid', 'event', (m) => m.type === t)) fail(`покрытие: нет правильного события ${t}`);
for (const [label, pred] of [
  ['code 200', (m) => m.code === 200 && Object.keys(m).length === 3],
  ['code 400', (m) => m.code === 400],
  ['applied: pushed', (m) => m.applied === 'pushed'],
  ['applied: flag_only', (m) => m.applied === 'flag_only'],
  ['checks', (m) => m.checks !== undefined],
  ...['schedversion', 'timezone', 'otaallowed'].map((p) => [`GET ${p}`, (m) => m.param === p]),
]) if (!has('valid', 'command-result', pred)) fail(`покрытие: нет правильного результата «${label}»`);
for (const name of Object.keys(validators)) {
  for (const kind of ['valid', 'invalid']) {
    if (!Object.keys(examples[kind]).some((n) => n.startsWith(`${name}--`))) fail(`у схемы «${name}» нет примеров ${kind}`);
  }
}

const total = Object.keys(examples.valid).length + Object.keys(examples.invalid).length;
console.log(failed ? `Ошибок: ${failed}` : `OK: ${Object.keys(validators).length} схем, ${total} примеров, покрытие команд и событий полное`);
process.exit(failed ? 1 : 0);
