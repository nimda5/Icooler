// Подменённый API и отрисовка портала для тестов.
import { render } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router';
import { Providers, makeQueryClient } from '../providers';
import { App } from '../App';
import { setFetch } from '../api/client';

export type Handler = (req: Request, body: unknown) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;
export interface Call { method: string; path: string; body: unknown; headers: Headers }

export function fakeApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(String(input), 'http://localhost'), init);
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const text = req.method === 'GET' ? '' : await req.clone().text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: req.method, path: path + url.search, body, headers: req.headers });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === req.method && new RegExp(`^${p!.replace(/:\w+/g, '[^/]+')}$`).test(path);
    });
    const r = key ? await routes[key]!(req, body) : { status: 404, body: { type: 'x', title: 'Not Found', status: 404 } };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status, headers: { 'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json' },
    });
  };
  setFetch(f as typeof fetch);
  return calls;
}

export const profile = (role: string) => ({ id: '00000000-0000-4000-8000-000000000001', email: `${role}@a.example`, name: `${role} user`, language: 'en', role, tenant_id: role === 'sig_admin' ? null : '11111111-1111-4111-8111-111111111111' });
export const page = (items: unknown[]) => ({ items, next_cursor: null });

export function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Providers client={makeQueryClient()}><App /><Link to="/profile" hidden>test:go-profile</Link></Providers>
    </MemoryRouter>,
  );
}

