// Портал оператора с подменённым API: вход, меню по ролям, CSRF, 401, пользователи, настройки, ссылки из писем.
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { csrf } from '../api/client';
import { fakeApi, page, profile, renderAt } from './fake';

describe('вход', () => {
  it('без сессии — страница входа; неверный пароль — сообщение; верный — CSRF сохранён и первый доступный раздел', async () => {
    let signedIn = false;
    fakeApi({
      'GET /me': () => (signedIn ? { status: 200, body: profile('admin') } : { status: 401, body: { type: 'x', title: 'Unauthorized', status: 401 } }),
      'POST /auth/login': (_r, b) => {
        const { password } = b as { password: string };
        if (password !== 'right password 1') return { status: 401, body: { type: 'x', title: 'Unauthorized', status: 401, detail: 'Неверный e-mail или пароль' } };
        signedIn = true;
        return { status: 200, body: { user: profile('admin'), csrf_token: 'csrf-1', expires_at: '2030-01-01T00:00:00Z' } };
      },
      'GET /users': () => ({ status: 200, body: page([]) }),
    });
    const u = userEvent.setup();
    renderAt('/users');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await u.type(screen.getByLabelText(/E-mail/), 'admin@a.example');
    await u.type(screen.getByLabelText(/Password/), 'wrong');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong e-mail or password');
    await u.clear(screen.getByLabelText(/Password/));
    await u.type(screen.getByLabelText(/Password/), 'right password 1');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument(); // вернулись, откуда пришли
    expect(csrf.get()).toBe('csrf-1');
  });

  it('блокировка входа (423) и лимит (429) — понятные сообщения', async () => {
    let n = 0;
    fakeApi({
      'GET /me': () => ({ status: 401, body: { type: 'x', title: 'Unauthorized', status: 401 } }),
      'POST /auth/login': () => (n++ === 0 ? { status: 423, body: { type: 'x', title: 'Locked', status: 423 } } : { status: 429, body: { type: 'x', title: 'Too Many Requests', status: 429 } }),
    });
    const u = userEvent.setup();
    renderAt('/login');
    await u.type(await screen.findByLabelText(/E-mail/), 'a@a.example');
    await u.type(screen.getByLabelText(/Password/), 'x');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily locked/);
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many attempts/);
  });
});

describe('меню по ролям (x-roles контракта)', () => {
  const sections = async (role: string) => {
    fakeApi({ 'GET /me': () => ({ status: 200, body: profile(role) }), 'GET /users': () => ({ status: 200, body: page([]) }), 'GET /audit-log': () => ({ status: 200, body: page([]) }) });
    renderAt('/profile');
    const nav = await screen.findByRole('navigation', { name: 'Sections' }).catch(() => screen.findByLabelText('Sections'));
    return within(nav).getAllByRole('link').map((a) => a.textContent);
  };
  it('Admin — все разделы оператора, кроме арендаторов', async () => {
    expect(await sections('admin')).toEqual(['Dashboard', 'Devices', 'Map', 'Clients', 'Alerts', 'Reports', 'eSIM', 'Users', 'End users', 'Audit log', 'Settings']);
  });
  it('Exec — просмотр, без пользователей, End User и настроек; аудит — есть', async () => {
    expect(await sections('exec')).toEqual(['Dashboard', 'Devices', 'Map', 'Clients', 'Alerts', 'Reports', 'Audit log']);
  });
  it('Dispatcher — End User есть, пользователей оператора, аудита и настроек нет', async () => {
    expect(await sections('dispatcher')).toEqual(['Dashboard', 'Devices', 'Map', 'Clients', 'Alerts', 'Reports', 'eSIM', 'End users']);
  });
  it('SIG Administrator — только арендаторы', async () => {
    expect(await sections('sig_admin')).toEqual(['Tenants']);
  });
  it('раздел, недоступный роли, по прямой ссылке — «не найдено»', async () => {
    fakeApi({ 'GET /me': () => ({ status: 200, body: profile('exec') }) });
    renderAt('/users');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('сессия', () => {
  it('изменяющий запрос несёт X-CSRF-Token; 401 — переход на вход и токен забыт', async () => {
    csrf.set('csrf-xyz');
    let alive = true;
    const calls = fakeApi({
      'GET /me': () => (alive ? { status: 200, body: profile('tech') } : { status: 401, body: { type: 'x', title: 'Unauthorized', status: 401 } }),
      'PATCH /me': (_r, b) => { alive = false; void b; return { status: 401, body: { type: 'x', title: 'Unauthorized', status: 401 } }; },
    });
    const u = userEvent.setup();
    renderAt('/profile');
    const name = await screen.findByLabelText(/^Name/);
    await u.clear(name);
    await u.type(name, 'New name');
    await u.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.headers.get('X-CSRF-Token')).toBe('csrf-xyz');
    expect(patch.body).toEqual({ name: 'New name', language: 'en' });
    expect(csrf.get()).toBeNull();
  });
});

describe('пользователи', () => {
  it('приглашение: тело по контракту; ошибки 422 — у полей', async () => {
    let n = 0;
    const calls = fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /users': () => ({ status: 200, body: page([]) }),
      'POST /users': () => (n++ === 0
        ? { status: 422, body: { type: 'x', title: 'Unprocessable', status: 422, errors: [{ path: '/email', message: 'must match format "email"' }] } }
        : { status: 201, body: { id: '00000000-0000-4000-8000-000000000009', email: 'new@a.example', name: 'New', language: 'en', role: 'exec', status: 'invited', last_login_at: null, created_at: '2026-11-28T00:00:00Z' } }),
    });
    const u = userEvent.setup();
    renderAt('/users');
    await u.click(await screen.findByRole('button', { name: 'Invite user' }));
    const dlg = await screen.findByRole('dialog');
    await u.type(within(dlg).getByLabelText(/E-mail/), 'new@a.example');
    await u.type(within(dlg).getByLabelText(/^Name/), 'New');
    await u.click(within(dlg).getByRole('button', { name: 'Invite user' }));
    expect(await within(dlg).findByText('must match format "email"')).toBeInTheDocument();
    await u.click(within(dlg).getByRole('button', { name: 'Invite user' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path === '/users')).toHaveLength(2));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ email: 'new@a.example', name: 'New', role: 'tech', language: 'en' });
  });

  it('свою учётную запись нельзя заблокировать или удалить из списка', async () => {
    fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /users': () => ({ status: 200, body: page([
        { ...profile('admin'), status: 'active', last_login_at: null, created_at: '2026-11-28T00:00:00Z' },
        { id: '00000000-0000-4000-8000-000000000002', email: 'tech@a.example', name: 'Tech', language: 'en', role: 'tech', status: 'active', last_login_at: null, created_at: '2026-11-28T00:00:00Z' },
      ]) }),
    });
    renderAt('/users');
    const self = (await screen.findByText('admin@a.example')).closest('tr')!;
    expect(within(self).queryByRole('button', { name: 'Block' })).toBeNull();
    expect(within(self).queryByRole('button', { name: 'Delete' })).toBeNull();
    const other = screen.getByText('tech@a.example').closest('tr')!;
    expect(within(other).getByRole('button', { name: 'Block' })).toBeInTheDocument();
  });
});

describe('настройки', () => {
  const all = (over: Record<string, { value: number; level: string }> = {}) => ({
    offline_after_min: { value: 3, level: 'platform' }, offline_alert_after_min: { value: 15, level: 'platform' },
    hot_alert_below_set_c: { value: 10, level: 'platform' }, hot_alert_above_c: { value: 99, level: 'platform' },
    hot_alert_after_min: { value: 10, level: 'platform' }, cold_alert_above_set_c: { value: 5, level: 'platform' },
    cold_alert_below_c: { value: 1, level: 'platform' }, cold_alert_after_min: { value: 15, level: 'platform' },
    filter_warning_pct: { value: 20, level: 'platform' }, filter_critical_pct: { value: 5, level: 'platform' },
    upcoming_filters_days: { value: 30, level: 'platform' }, filter_forecast_window_days: { value: 30, level: 'platform' }, ...over,
  });
  it('уровень значения виден; «сбросить к унаследованному» шлёт null', async () => {
    const calls = fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /settings': () => ({ status: 200, body: all({ offline_alert_after_min: { value: 30, level: 'tenant' } }) }),
      'PATCH /settings': () => ({ status: 200, body: all() }),
    });
    const u = userEvent.setup();
    renderAt('/settings');
    expect(await screen.findAllByText('Tenant')).toHaveLength(1);
    await u.click(screen.getByRole('button', { name: 'Reset to inherited' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ offline_alert_after_min: null }));
    await waitFor(() => expect(screen.getByLabelText('“Offline” alert after, min')).toHaveValue('15'));
    expect(screen.queryAllByText('Tenant')).toHaveLength(0);
  });
});

describe('ссылки из писем', () => {
  it('приглашение без токена или с истёкшим — «недействительно»; новый пароль проверяется до отправки', async () => {
    const calls = fakeApi({
      'GET /me': () => ({ status: 401, body: { type: 'x', title: 'Unauthorized', status: 401 } }),
      'POST /auth/invitations/accept': () => ({ status: 410, body: { type: 'x', title: 'Gone', status: 410 } }),
    });
    const u = userEvent.setup();
    const { unmount } = renderAt('/invite');
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument();
    unmount();
    renderAt('/invite?token=0123456789abcdef0123');
    await u.type(await screen.findByLabelText(/^New password/), 'short');
    await u.type(screen.getByLabelText(/^Repeat password/), 'short');
    await u.click(screen.getByRole('button', { name: /Set password/ }));
    expect(await screen.findByText('At least 12 characters', { selector: '.mantine-InputWrapper-error' })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await u.clear(screen.getByLabelText(/^New password/));
    await u.clear(screen.getByLabelText(/^Repeat password/));
    await u.type(screen.getByLabelText(/^New password/), 'long enough password');
    await u.type(screen.getByLabelText(/^Repeat password/), 'long enough password');
    await u.click(screen.getByRole('button', { name: /Set password/ }));
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument();
  });

  it('«забыли пароль» — одинаковый ответ', async () => {
    fakeApi({ 'GET /me': () => ({ status: 401, body: { type: 'x', title: 'Unauthorized', status: 401 } }), 'POST /auth/password/forgot': () => ({ status: 202 }) });
    const u = userEvent.setup();
    renderAt('/forgot');
    await u.type(await screen.findByLabelText(/E-mail/), 'anyone@a.example');
    await u.click(screen.getByRole('button', { name: 'Send link' }));
    expect(await screen.findByText(/If an account exists/)).toBeInTheDocument();
  });
});

const TOKEN_OK = '0123456789abcdef0123';
const unauthorized = { status: 401, body: { type: 'x', title: 'Unauthorized', status: 401 } };
const usr = (n: number, email: string) => ({ id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, email, name: `Person ${n}`, language: 'en', role: 'tech', status: 'active', last_login_at: null, created_at: '2026-11-28T00:00:00Z' });

describe('смена сессии и ошибки', () => {
  it('выход с ошибкой сервера (429) — сессия остаётся, ошибка показана; повтор — выход', async () => {
    let n = 0;
    fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'POST /auth/logout-all': () => (n++ === 0 ? { status: 429, body: { type: 'x', title: 'Too Many Requests', status: 429, detail: 'Превышен лимит запросов' } } : { status: 204 }),
    });
    csrf.set('keep-me');
    const u = userEvent.setup();
    renderAt('/profile');
    await u.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    expect(await screen.findByText('Превышен лимит запросов')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    expect(csrf.get()).toBe('keep-me');
    await u.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(csrf.get()).toBeNull();
  });

  it('вход другим пользователем: данные прежнего не показываются ни на миг', async () => {
    let who = 'A';
    let releaseB: () => void = () => {};
    const bUsers = new Promise<void>((r) => { releaseB = r; });
    fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /users': async () => (who === 'A' ? { status: 200, body: page([usr(1, 'old-tenant@a.example')]) } : (await bUsers, { status: 200, body: page([usr(2, 'new-tenant@b.example')]) })),
      'POST /auth/logout': () => ({ status: 204 }),
      'POST /auth/login': () => { who = 'B'; return { status: 200, body: { user: { ...profile('admin'), id: '00000000-0000-4000-8000-0000000000bb' }, csrf_token: 'csrf-b', expires_at: '2030-01-01T00:00:00Z' } }; },
    });
    const u = userEvent.setup();
    renderAt('/users');
    expect(await screen.findByText('old-tenant@a.example')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Profile' }));
    await u.click(await screen.findByRole('menuitem', { name: 'Log out' }));
    await u.type(await screen.findByLabelText(/E-mail/), 'b@b.example');
    await u.type(screen.getByLabelText(/Password/), 'password of b 1');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByLabelText('Sections');
    await u.click(screen.getByRole('link', { name: 'Users' }));
    expect(screen.queryByText('old-tenant@a.example')).toBeNull(); // список B ещё грузится — старого нет
    releaseB();
    expect(await screen.findByText('new-tenant@b.example')).toBeInTheDocument();
    expect(screen.queryByText('old-tenant@a.example')).toBeNull();
  });

  it('поздний 401 запроса прежней сессии не сбрасывает новую; поздний ответ профиля — не применяется', async () => {
    let releasePatch: () => void = () => {};
    const patchDone = new Promise<void>((r) => { releasePatch = r; });
    fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'PATCH /me': async () => { await patchDone; return unauthorized; },
      'POST /auth/logout-all': () => ({ status: 204 }),
      'POST /auth/login': () => ({ status: 200, body: { user: { ...profile('tech'), name: 'Fresh session' }, csrf_token: 'csrf-2', expires_at: '2030-01-01T00:00:00Z' } }),
    });
    const u = userEvent.setup();
    renderAt('/profile');
    await u.click((await screen.findAllByRole('button', { name: 'Save' }))[0]!); // PATCH висит
    await u.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    await u.type(await screen.findByLabelText(/E-mail/), 'tech@a.example');
    await u.type(screen.getByLabelText(/Password/), 'password tech 1');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Fresh session')).toBeInTheDocument();
    releasePatch(); // 401 прежней сессии приходит после нового входа
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    expect(csrf.get()).toBe('csrf-2');
  });

  it('ошибка загрузки списка — сообщение и повтор, а не пустой список', async () => {
    let n = 0;
    fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /users': () => (n++ === 0 ? { status: 500, body: { type: 'x', title: 'Internal Server Error', status: 500 } } : { status: 200, body: page([usr(3, 'back@a.example')]) }),
    });
    const u = userEvent.setup();
    renderAt('/users');
    const alert = (await screen.findByText('Something went wrong')).closest('[role=alert]') as HTMLElement;
    await u.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('back@a.example')).toBeInTheDocument();
  });

  it('ошибки смены пароля — у своих полей (current_password → «текущий», new_password → «новый»)', async () => {
    fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'PUT /me/password': () => ({ status: 422, body: { type: 'x', title: 'Unprocessable', status: 422, errors: [{ path: '/current_password', message: 'неверен' }, { path: '/new_password', message: 'слишком простой' }] } }),
    });
    const u = userEvent.setup();
    renderAt('/profile');
    await u.type(await screen.findByLabelText(/^Current password/), 'old password 1');
    await u.type(screen.getByLabelText(/^New password/), 'new long password');
    await u.type(screen.getByLabelText(/^Repeat password/), 'new long password');
    await u.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('неверен')).toBeInTheDocument();
    expect(screen.getByText('слишком простой')).toBeInTheDocument();
  });

  it('ссылка с некорректным токеном — сразу «недействительна»; 422 по токену — тоже', async () => {
    fakeApi({
      'GET /me': () => unauthorized,
      'POST /auth/password/reset': () => ({ status: 422, body: { type: 'x', title: 'Unprocessable', status: 422, errors: [{ path: '/token', message: 'must NOT have fewer than 16 characters' }] } }),
    });
    const { unmount } = renderAt('/reset-password?token=short');
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument();
    unmount();
    const u = userEvent.setup();
    renderAt(`/reset-password?token=${TOKEN_OK}`);
    await u.type(await screen.findByLabelText(/^New password/), 'long enough password');
    await u.type(screen.getByLabelText(/^Repeat password/), 'long enough password');
    await u.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument();
  });
});

describe('настройки и End User', () => {
  it('сброс одного параметра не теряет несохранённую правку другого', async () => {
    const base = { value: 3, level: 'platform' };
    const all = (o: Record<string, unknown> = {}) => Object.fromEntries(['offline_after_min', 'offline_alert_after_min', 'hot_alert_below_set_c', 'hot_alert_above_c',
      'hot_alert_after_min', 'cold_alert_above_set_c', 'cold_alert_below_c', 'cold_alert_after_min', 'filter_warning_pct', 'filter_critical_pct',
      'upcoming_filters_days', 'filter_forecast_window_days'].map((k) => [k, (o as Record<string, unknown>)[k] ?? { ...base, value: k.includes('pct') ? 20 : 10 }]));
    const calls = fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /settings': () => ({ status: 200, body: all({ offline_alert_after_min: { value: 30, level: 'tenant' } }) }),
      'PATCH /settings': () => ({ status: 200, body: all() }),
    });
    const u = userEvent.setup();
    renderAt('/settings');
    const a = await screen.findByLabelText('Device offline after no heartbeat, min');
    await u.clear(a);
    await u.type(a, '7');
    await u.click(screen.getByRole('button', { name: 'Reset to inherited' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ offline_alert_after_min: null });
    await waitFor(() => expect(screen.getByLabelText('Device offline after no heartbeat, min')).toHaveValue('7'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('сброс поля с несохранённой правкой — поле показывает унаследованное значение, черновик поля убран', async () => {
    const mk = (v: number, level: string) => ({ value: v, level });
    const keys = ['offline_after_min', 'offline_alert_after_min', 'hot_alert_below_set_c', 'hot_alert_above_c', 'hot_alert_after_min', 'cold_alert_above_set_c',
      'cold_alert_below_c', 'cold_alert_after_min', 'filter_warning_pct', 'filter_critical_pct', 'upcoming_filters_days', 'filter_forecast_window_days'];
    const body = (alert: { value: number; level: string }) => Object.fromEntries(keys.map((k) => [k, k === 'offline_alert_after_min' ? alert : mk(k.includes('pct') ? 20 : 10, 'platform')]));
    fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /settings': () => ({ status: 200, body: body(mk(30, 'tenant')) }),
      'PATCH /settings': () => ({ status: 200, body: body(mk(15, 'platform')) }),
    });
    const u = userEvent.setup();
    renderAt('/settings');
    const f = await screen.findByLabelText('“Offline” alert after, min');
    await u.clear(f);
    await u.type(f, '7');
    await u.click(screen.getByRole('button', { name: 'Reset to inherited' }));
    await waitFor(() => expect(screen.getByLabelText('“Offline” alert after, min')).toHaveValue('15'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('ошибка загрузки клиентов — видна и повторяется в приглашении End User', async () => {
    let n = 0;
    fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /end-users': () => ({ status: 200, body: page([]) }),
      'GET /clients': () => (n++ === 0 ? { status: 500, body: { type: 'x', title: 'Internal Server Error', status: 500 } }
        : { status: 200, body: page([{ id: '00000000-0000-4000-8000-0000000000c1', type: 'organization', name: 'Client One', created_at: '2026-11-28T00:00:00Z' }]) }),
    });
    const u = userEvent.setup();
    renderAt('/end-users');
    await u.click(await screen.findByRole('button', { name: 'Invite end user' }));
    const dlg = await screen.findByRole('dialog');
    const alert = (await within(dlg).findByText('Something went wrong')).closest('[role=alert]') as HTMLElement;
    await u.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(dlg).queryByText('Something went wrong')).toBeNull());
    expect(within(dlg).getByRole('button', { name: 'Invite end user' })).toBeEnabled();
  });

  it('End User: имя и язык меняются; тело — по контракту', async () => {
    const eu = { id: '00000000-0000-4000-8000-0000000000e1', email: 'eu@a.example', name: 'Old Name', language: 'en', status: 'active', clients: [], last_login_at: null, created_at: '2026-11-28T00:00:00Z' };
    const calls = fakeApi({
      'GET /me': () => ({ status: 200, body: profile('dispatcher') }),
      'GET /end-users': () => ({ status: 200, body: page([eu]) }),
      'GET /clients': () => ({ status: 404, body: { type: 'x', title: 'Not Found', status: 404 } }),
      'PATCH /end-users/:id': () => ({ status: 200, body: { ...eu, name: 'New Name' } }),
    });
    const u = userEvent.setup();
    renderAt('/end-users');
    const row = (await screen.findByText('eu@a.example')).closest('tr')!;
    await u.click(within(row).getByRole('button', { name: 'Edit' }));
    const dlg = await screen.findByRole('dialog');
    const name = within(dlg).getByLabelText(/^Name/);
    await u.clear(name);
    await u.type(name, 'New Name');
    await u.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'New Name', language: 'en' }));
  });
});

describe('настройки: поздний ответ прежней сессии', () => {
  it('ответ PATCH сессии A после входа B не попадает в настройки B', async () => {
    const keys = ['offline_after_min', 'offline_alert_after_min', 'hot_alert_below_set_c', 'hot_alert_above_c', 'hot_alert_after_min', 'cold_alert_above_set_c',
      'cold_alert_below_c', 'cold_alert_after_min', 'filter_warning_pct', 'filter_critical_pct', 'upcoming_filters_days', 'filter_forecast_window_days'];
    const body = (v: number) => Object.fromEntries(keys.map((k) => [k, { value: k === 'offline_after_min' ? v : 10, level: 'platform' }]));
    let who = 'A';
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => { release = r; });
    fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /settings': () => ({ status: 200, body: body(who === 'A' ? 3 : 44) }),
      'PATCH /settings': async () => { await hold; return { status: 200, body: body(55) }; },
      'POST /auth/logout-all': () => ({ status: 204 }),
      'POST /auth/login': () => { who = 'B'; return { status: 200, body: { user: profile('admin'), csrf_token: 'b', expires_at: '2030-01-01T00:00:00Z' } }; },
    });
    const u = userEvent.setup();
    renderAt('/settings');
    const f = await screen.findByLabelText('Device offline after no heartbeat, min');
    await u.clear(f);
    await u.type(f, '55');
    await u.click(screen.getByRole('button', { name: 'Save' })); // висит
    await u.click(screen.getByText('test:go-profile')); // переход на профиль — тест не о меню
    await u.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    await u.type(await screen.findByLabelText(/E-mail/), 'b@b.example');
    await u.type(screen.getByLabelText(/Password/), 'password of b 1');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByLabelText('Sections');
    await u.click(screen.getByRole('link', { name: 'Settings' }));
    await waitFor(() => expect(screen.getByLabelText('Device offline after no heartbeat, min')).toHaveValue('44'));
    release(); // ответ A приходит после входа B
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText('Device offline after no heartbeat, min')).toHaveValue('44');
  }, 15_000); // длинный сценарий: сохранение, выход, вход, проверка
});

describe('настройки: ввод и очередь', () => {
  const keys = ['offline_after_min', 'offline_alert_after_min', 'hot_alert_below_set_c', 'hot_alert_above_c', 'hot_alert_after_min', 'cold_alert_above_set_c',
    'cold_alert_below_c', 'cold_alert_after_min', 'filter_warning_pct', 'filter_critical_pct', 'upcoming_filters_days', 'filter_forecast_window_days'];
  const body = (o: Record<string, { value: number; level: string }> = {}) => Object.fromEntries(keys.map((k) => [k, o[k] ?? { value: 5, level: 'platform' }]));

  it('очистить поле и ввести заново — уходит введённое число, а не серверное значение с приставкой', async () => {
    const calls = fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /settings': () => ({ status: 200, body: body() }),
      'PATCH /settings': () => ({ status: 200, body: body({ offline_after_min: { value: 9, level: 'tenant' } }) }),
    });
    const u = userEvent.setup();
    renderAt('/settings');
    const f = await screen.findByLabelText('Device offline after no heartbeat, min');
    await u.clear(f); await u.type(f, '7'); await u.clear(f);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(); // пустое — не сохраняется
    await u.type(f, '9');
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ offline_after_min: 9 }));
  });

  it('пока идёт сохранение, сброс недоступен — поздний ответ не перезапишет следующий', async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => { release = r; });
    fakeApi({
      'GET /me': () => ({ status: 200, body: profile('admin') }),
      'GET /settings': () => ({ status: 200, body: body({ offline_alert_after_min: { value: 30, level: 'tenant' } }) }),
      'PATCH /settings': async () => { await hold; return { status: 200, body: body({ offline_after_min: { value: 7, level: 'tenant' }, offline_alert_after_min: { value: 30, level: 'tenant' } }) }; },
    });
    const u = userEvent.setup();
    renderAt('/settings');
    const f = await screen.findByLabelText('Device offline after no heartbeat, min');
    await u.clear(f); await u.type(f, '7');
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset to inherited' })).toBeDisabled());
    release();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Reset to inherited' }).every((x) => !x.hasAttribute('disabled'))).toBe(true));
  });
});

describe('тема', () => {
  it('переключатель светлой и тёмной темы', async () => {
    fakeApi({ 'GET /me': () => ({ status: 200, body: profile('admin') }), 'GET /users': () => ({ status: 200, body: page([]) }) });
    const u = userEvent.setup();
    renderAt('/profile');
    await u.click(await screen.findByRole('button', { name: 'Dark theme' }));
    expect(document.documentElement).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await u.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(document.documentElement).toHaveAttribute('data-mantine-color-scheme', 'light');
  });
});
