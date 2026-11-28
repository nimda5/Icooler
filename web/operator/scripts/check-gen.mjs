// Сгенерированные из контракта файлы должны совпадать с contracts/openapi — иначе `pnpm gen`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = ['src/api/schema.d.ts', 'src/api/roles.json'];
const before = files.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
execFileSync('pnpm', ['run', '-s', 'gen'], { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
const stale = files.filter((f, i) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8') !== before[i]);
if (stale.length) {
  console.error(`Устарели: ${stale.join(', ')} — запустите pnpm gen и закоммитьте.`);
  process.exit(1);
}
