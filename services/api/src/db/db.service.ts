// Доступ к БД: каждая операция — транзакция под ролью app_api с арендатором запроса (RLS, §7.2, P-07).
import pg from 'pg';
import type { Config } from '../config.ts';

export interface Scope {
  /** Арендатор запроса; null — без арендатора (только функции входа). */
  tenantId: string | null;
  /** SIG Administrator: строки вне арендатора (app.scope = global). */
  global?: boolean;
  /** Чтение в одном снимке из нескольких запросов (карта): REPEATABLE READ. */
  snapshot?: boolean;
}

export class Db {
  /** Nest: закрыть пул при остановке приложения. */
  async onApplicationShutdown(): Promise<void> { await this.close(); }

  readonly pool: pg.Pool;
  readonly #role: string;

  constructor(cfg: Pick<Config, 'databaseUrl' | 'dbRole'>) {
    this.pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 10 });
    if (!/^[a-z_]+$/.test(cfg.dbRole)) throw new Error('DB_ROLE: только [a-z_]');
    this.#role = cfg.dbRole;
  }

  async tx<T>(scope: Scope, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query(scope.snapshot ? 'begin isolation level repeatable read' : 'begin');
      await c.query(`set local role ${this.#role}`);
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.scope', $2, true)`,
        [scope.tenantId ?? '', scope.global ? 'global' : '']);
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  #closed = false;
  async close(): Promise<void> { if (!this.#closed) { this.#closed = true; await this.pool.end(); } }
}
