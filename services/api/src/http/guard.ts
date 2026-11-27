// Каждый запрос: операция контракта → лимиты (§7.4) → сессия → роль по x-roles (§7.1) → CSRF → тело по схеме.
// Ошибка — problem+json (ProblemFilter). Объект другого арендатора или чужой для End User — 404 в обработчике (RLS).
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { OP_KEY } from './op.ts';
import { Problem, forbidden, unauthorized } from './problem.ts';
import { RateLimiter, limitsFor } from './rate-limit.ts';
import { operation, type Role } from '../openapi/spec.ts';
import { csrfOk, sha256 } from '../auth/crypto.ts';
import type { RequestContext } from '../auth/context.ts';
import { Db } from '../db/db.service.ts';
import { CONFIG } from '../tokens.ts';
import type { Config } from '../config.ts';

export const SESSION_COOKIE = 'session';

@Injectable()
export class ApiGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(Db) private readonly db: Db,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const opId = this.reflector.get<string>(OP_KEY, ctx.getHandler());
    if (!opId) throw new Problem(500, 'обработчик без @Op');
    const op = operation(opId);
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { icooler: RequestContext; cookies: Record<string, string | undefined> }>();
    const c: RequestContext = { ip: req.ip, opId, userId: null, tenantId: null, role: null, sessionHash: null };
    req.icooler = c;

    const isPublic = op.roles.includes('public');
    const token = req.cookies[SESSION_COOKIE];
    if (!isPublic || token) {
      if (token) {
        const hash = sha256(token);
        const s = await this.db.tx({ tenantId: null }, async (cl) =>
          (await cl.query('select * from app.auth_lookup_session($1)', [hash])).rows[0]);
        if (s) Object.assign(c, { userId: s.user_id, tenantId: s.tenant_id, role: s.role as Role, sessionHash: hash });
      }
    }
    this.limiter.hit(limitsFor(opId, c.ip, c.userId, c.role));
    if (!isPublic) {
      if (!c.userId) throw unauthorized();
      if (!op.roles.includes('any') && !op.roles.includes(c.role!)) throw forbidden();
      if (op.method !== 'GET' && !csrfOk(this.cfg.csrfSecret, c.sessionHash!, header(req, 'x-csrf-token'))) {
        throw forbidden('Нет или неверен X-CSRF-Token');
      }
    }
    if (op.validateQuery && !op.validateQuery(req.query ?? {})) {
      throw new Problem(422, 'Параметры запроса не прошли проверку', {
        errors: (op.validateQuery.errors ?? []).map((e) => ({ path: e.instancePath || '/', message: e.message ?? '' })),
      });
    }
    if (op.validateBody && !op.validateBody(req.body ?? {})) {
      throw new Problem(422, 'Тело запроса не прошло проверку', {
        errors: (op.validateBody.errors ?? []).map((e) => ({ path: e.instancePath || '/', message: e.message ?? '' })),
      });
    }
    return true;
  }
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
