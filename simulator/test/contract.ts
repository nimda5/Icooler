// Проверка сообщений по схемам contracts/ и смысловым правилам contracts/scripts/semantics.mjs.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Outgoing } from '../src/messages.ts';
// @ts-expect-error — модуль .mjs без типов
import { semanticErrors } from '../../contracts/scripts/semantics.mjs';

const dir = fileURLToPath(new URL('../../contracts/schemas/', import.meta.url));
const ajv = new (Ajv2020 as unknown as typeof Ajv2020.default)({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
(addFormats as unknown as typeof addFormats.default)(ajv);
for (const f of readdirSync(dir).filter((x) => x.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(readFileSync(dir + f, 'utf8')), f);

const SCHEMA = { frame: 'frame', event: 'event', heartbeat: 'heartbeat', hello: 'hello', ack: 'command-ack', result: 'command-result' } as const;

/** Ошибки сообщения; пустой массив — сообщение соответствует контракту. */
export function contractErrors(m: Outgoing): string[] {
  const name = SCHEMA[m.mt];
  const v = ajv.getSchema(`${name}.schema.json`)!;
  if (!v(m.body)) return (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
  return semanticErrors(name, m.body) as string[];
}

/** Команда платформы тоже проверяется: тест не должен слать то, чего платформа не пошлёт. */
export function commandErrors(c: object): string[] {
  const v = ajv.getSchema('command.schema.json')!;
  if (!v(c)) return (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
  return semanticErrors('command', c) as string[];
}
