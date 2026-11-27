// Лимиты запросов ТЗ §7.4 — фиксированное окно в памяти процесса. При нескольких репликах — заменить на Redis
// (тот же интерфейс), иначе лимит считается на реплику.
import { Problem } from './problem.ts';

export interface Limit { key: string; max: number; windowS: number }

export class RateLimiter {
  readonly #hits = new Map<string, { n: number; until: number }>();
  readonly #now: () => number;
  constructor(now: () => number = Date.now) { this.#now = now; }

  /** Засчитать попытку по каждому лимиту; превышен любой — 429 с Retry-After. */
  hit(limits: Limit[]): void {
    const now = this.#now();
    let retry = 0;
    for (const l of limits) {
      const k = `${l.key}|${l.windowS}`;
      let h = this.#hits.get(k);
      if (!h || h.until <= now) { h = { n: 0, until: now + l.windowS * 1000 }; this.#hits.set(k, h); }
      h.n++;
      if (h.n > l.max) retry = Math.max(retry, Math.ceil((h.until - now) / 1000));
    }
    if (this.#hits.size > 100_000) for (const [k, v] of this.#hits) if (v.until <= now) this.#hits.delete(k);
    if (retry) throw new Problem(429, 'Превышен лимит запросов', {}, { 'Retry-After': String(retry) });
  }
}

/** Лимиты операции (§7.4): вход, восстановление пароля, API оператора и End User. */
export function limitsFor(opId: string, ip: string, userId: string | null, role: string | null): Limit[] {
  if (opId === 'login') return [{ key: `login-ip:${ip}`, max: 10, windowS: 60 }];
  if (opId === 'forgotPassword') return [{ key: `forgot-ip:${ip}`, max: 20, windowS: 3600 }];
  if (role === 'end_user') return [{ key: `eu-user:${userId}`, max: 120, windowS: 60 }, { key: `eu-ip:${ip}`, max: 300, windowS: 60 }];
  if (userId) return [{ key: `op-user:${userId}`, max: 600, windowS: 60 }];
  return [{ key: `anon-ip:${ip}`, max: 60, windowS: 60 }];
}
