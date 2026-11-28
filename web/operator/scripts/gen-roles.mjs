// Права операций из контракта: operationId → x-roles. Портал скрывает недоступное (проверка — на сервере, §7.1).
import { readFileSync, writeFileSync } from 'node:fs';

// X-CSRF-Token ставит клиент (src/api/client.ts) — в типах заголовок необязателен.
const typesUrl = new URL('../src/api/schema.d.ts', import.meta.url);
// Все заголовки операций в контракте — X-CSRF-Token и необязательный Idempotency-Key.
const types = readFileSync(typesUrl, 'utf8')
  .replaceAll('"X-CSRF-Token": components["parameters"]["CsrfToken"];', '"X-CSRF-Token"?: components["parameters"]["CsrfToken"];')
  .replace(/^(\s+)header: \{$/gm, '$1header?: {');
writeFileSync(typesUrl, types);
import { parse } from 'yaml';

const doc = parse(readFileSync(new URL('../../../contracts/openapi/openapi.yaml', import.meta.url), 'utf8'));
const roles = {};
for (const item of Object.values(doc.paths)) {
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) if (item[m]) roles[item[m].operationId] = item[m]['x-roles'];
}
const sorted = Object.fromEntries(Object.entries(roles).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(new URL('../src/api/roles.json', import.meta.url), JSON.stringify(sorted, null, 2) + '\n');
