// Корни: пакет services/api (где package.json) и репозиторий (где pnpm-workspace.yaml) — работает и из src, и из dist.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function up(marker: string): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(d, marker))) return d;
    const p = dirname(d);
    if (p === d) throw new Error(`не найден ${marker}`);
    d = p;
  }
}
export const packageRoot = (): string => up('drizzle.config.ts');
export const repoRoot = (): string => up('pnpm-workspace.yaml');
