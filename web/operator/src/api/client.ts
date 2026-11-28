// Клиент API по контракту contracts/openapi (типы — src/api/schema.d.ts, `pnpm gen`).
// Сессия — cookie (HttpOnly, ставит сервер); изменяющие запросы несут X-CSRF-Token из ответа входа.
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths, components } from './schema';

export type Schemas = components['schemas'];
export type Problem = Schemas['Problem'] & { errors?: { path: string; message: string }[] };

const CSRF_KEY = 'icooler.csrf';

/** CSRF-токен переживает перезагрузку страницы: сессия в cookie жива, а токен иначе потерялся бы. */
export const csrf = {
  get(): string | null { try { return localStorage.getItem(CSRF_KEY); } catch { return null; } },
  set(v: string | null): void {
    try { if (v) localStorage.setItem(CSRF_KEY, v); else localStorage.removeItem(CSRF_KEY); } catch { /* приватный режим */ }
  },
};

/** Поколение сессии: растёт при входе и выходе. Запрос помнит поколение, в котором ушёл. */
let gen = 0;
export const sessionGen = { current: () => gen, next: () => ++gen };
const genOf = new WeakMap<Request, number>();

type Listener = (gen: number) => void;
const unauthorized = new Set<Listener>();
/** 401 на запрос с сессией — с поколением, в котором запрос ушёл. */
export const onUnauthorized = (fn: Listener): (() => void) => { unauthorized.add(fn); return () => unauthorized.delete(fn); };

const PUBLIC = ['/auth/login', '/auth/password/forgot', '/auth/password/reset', '/auth/invitations/accept'];

const middleware: Middleware = {
  onRequest({ request }) {
    genOf.set(request, gen);
    if (request.method !== 'GET') {
      const t = csrf.get();
      if (t) request.headers.set('X-CSRF-Token', t);
    }
    return request;
  },
  onResponse({ request, response }) {
    if (response.status === 401 && !PUBLIC.some((p) => new URL(request.url).pathname.endsWith(p))) {
      const g = genOf.get(request) ?? gen;
      for (const fn of unauthorized) fn(g);
    }
    return response;
  },
};

export function makeClient(fetchImpl?: typeof fetch) {
  // Абсолютный адрес того же сайта: Request в Node (тесты) не принимает относительные.
  const baseUrl = `${globalThis.location?.origin ?? ''}/api/v1`;
  const c = createClient<paths>({ baseUrl, credentials: 'include', ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  c.use(middleware);
  return c;
}

export let api = makeClient();
/** Для тестов: подменить fetch. */
export const setFetch = (f: typeof fetch): void => { api = makeClient(f); };

/** Ошибка ответа — в исключение с текстом из problem+json. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | undefined;
  constructor(status: number, problem?: Problem) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.status = status;
    this.problem = problem;
  }
  /** Ошибки полей для формы: путь JSON Pointer → сообщение. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem?.errors ?? []).map((e) => [e.path.replace(/^\//, ''), e.message]));
  }
}

/** Результат openapi-fetch → данные или ApiError. */
export async function ok<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const r = await p;
  if (!r.response.ok) throw new ApiError(r.response.status, r.error as Problem | undefined);
  return r.data as T;
}
