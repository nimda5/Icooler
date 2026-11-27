import type { Role } from '../openapi/spec.ts';

export interface RequestContext {
  ip: string;
  opId: string;
  /** Есть сессия. */
  userId: string | null;
  tenantId: string | null;
  role: Role | null;
  /** sha256 идентификатора сессии. */
  sessionHash: string | null;
}
