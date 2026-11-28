// Видимость по ролям — из x-roles контракта (src/api/roles.json, `pnpm gen`). Это только скрытие:
// права проверяет сервер на каждый запрос (§7.1).
import roles from './roles.json';

export type Role = 'admin' | 'tech' | 'exec' | 'dispatcher' | 'end_user' | 'sig_admin';
export type OperationId = keyof typeof roles;

export function can(role: Role | undefined, op: OperationId): boolean {
  if (!role) return false;
  const r = roles[op] as string[];
  return r.includes('any') || r.includes(role);
}
