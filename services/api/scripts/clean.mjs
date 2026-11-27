// Убрать прежнюю сборку перед тестами, чтобы не запускались тесты удалённых файлов.
import { rmSync } from 'node:fs';
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
