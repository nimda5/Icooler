// Контракт API — contracts/openapi/openapi.yaml: маршрут, права (x-roles) и схема тела каждой операции берутся
// отсюда, а не дублируются в коде. Проверка тел — те же JSON Schema, что в контракте.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { repoRoot } from '../paths.ts';

export type Role = 'admin' | 'tech' | 'exec' | 'dispatcher' | 'end_user' | 'sig_admin';

export interface Operation {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Путь OpenAPI (/users/{userId}). */
  path: string;
  /** Путь Fastify (/users/:userId). */
  route: string;
  roles: string[];
  validateBody: ValidateFunction | null;
  /** Query-параметры по контракту (строки приводятся к типам схемы). */
  validateQuery: ValidateFunction | null;
  /** Схема успешного ответа: код → проверка тела (для тестов контракта). */
  responses: Map<string, ValidateFunction>;
}

interface RawParam { $ref?: string; name?: string; in?: string; required?: boolean; schema?: unknown }
interface RawOp {
  operationId: string; 'x-roles': string[]; requestBody?: { content: Record<string, { schema: unknown }> };
  parameters?: RawParam[]; responses: Record<string, { $ref?: string; content?: Record<string, { schema: unknown }> }>;
}

let cache: Map<string, Operation> | undefined;

export function operations(file = join(repoRoot(), 'contracts/openapi/openapi.yaml')): Map<string, Operation> {
  if (cache) return cache;
  const doc = parse(readFileSync(file, 'utf8')) as {
    paths: Record<string, Record<string, RawOp> & { parameters?: RawParam[] }>;
    components: { schemas: Record<string, unknown>; parameters: Record<string, RawParam> };
  };
  const make = (coerce: boolean) => {
    const a = new (Ajv2020 as unknown as typeof Ajv2020.default)({ strict: false, allErrors: true, coerceTypes: coerce });
    (addFormats as unknown as typeof addFormats.default)(a);
    a.addSchema({ $id: 'oas', $defs: rewrite(doc.components.schemas) });
    return a;
  };
  const rewrite = (x: unknown) => JSON.parse(JSON.stringify(x).replaceAll('#/components/schemas/', 'oas#/$defs/'));
  const ajv = make(false);
  const ajvQuery = make(true);
  const param = (p: RawParam): RawParam => (p.$ref ? doc.components.parameters[p.$ref.split('/').pop()!]! : p);
  const ops = new Map<string, Operation>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = item[m];
      if (!op) continue;
      const json = op.requestBody?.content?.['application/json']?.schema;
      const query = [...(item.parameters ?? []), ...(op.parameters ?? [])].map(param).filter((p) => p.in === 'query');
      const qSchema = {
        type: 'object', additionalProperties: false,
        properties: Object.fromEntries(query.map((p) => [p.name, p.schema])),
        required: query.filter((p) => p.required).map((p) => p.name),
      };
      const responses = new Map<string, ValidateFunction>();
      for (const [code, r] of Object.entries(op.responses)) {
        const sch = r.content?.['application/json']?.schema;
        if (code.startsWith('2') && sch) responses.set(code, ajv.compile(rewrite(sch)));
      }
      ops.set(op.operationId, {
        id: op.operationId,
        method: m.toUpperCase() as Operation['method'],
        path,
        route: path.replace(/\{(\w+)\}/g, ':$1'),
        roles: op['x-roles'],
        validateBody: json ? ajv.compile(rewrite(json)) : null,
        validateQuery: ajvQuery.compile(rewrite(qSchema)),
        responses,
      });
    }
  }
  cache = ops;
  return ops;
}

export function operation(id: string): Operation {
  const op = operations().get(id);
  if (!op) throw new Error(`операции ${id} нет в contracts/openapi/openapi.yaml`);
  return op;
}
