// Клиенты, устройства и карта с подменённым API: тела запросов по контракту, кнопки по ролям, перенос, история, карта.
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import L from 'leaflet';
import { fakeApi, page, profile, renderAt } from './fake';
import { bboxOf, groupByPoint } from '../pages/map';

const C1 = 'c0000000-0000-4000-8000-000000000001';
const C2 = 'c0000000-0000-4000-8000-000000000002';
const A2 = 'a0000000-0000-4000-8000-000000000002';
const D1 = 'd0000000-0000-4000-8000-000000000001';
const client = (id: string, name: string) => ({ id, type: 'organization', name, reg_number: null, legal_address: null, created_at: '2026-11-01T10:00:00Z' });
const device = {
  id: D1, device_id: 'cooler-001', serial: 'SN-001', imei: null, model: { water_source: 'mains', variant: 'A', carbonated: false, sku: null },
  fw: null, hw: null, cert_thumbprint: null, lifecycle: 'stock', state: 'offline', ownership: 'purchase', online: false, last_seen_at: null,
  offline_since: null, blocked: false, client_id: C1, address_id: null, esim_profile_id: null, description: null, created_at: '2026-11-01T10:00:00Z',
};
const listItem = { ...device, client_name: 'SIA Birojs', address: null, floor: null, place: null, alerts_open: 0, filter_left_pct: null, liters_period: null };
const card = { ...device, client: client(C1, 'SIA Birojs'), address_detail: null, current: null, alerts_open: 0, ota_allowed: null };
const base = (role: string) => ({
  'GET /me': () => ({ status: 200, body: profile(role) }),
  'GET /clients': () => ({ status: 200, body: page([{ ...client(C1, 'SIA Birojs'), devices_total: 1, alerts_open: 0 }, { ...client(C2, 'Kafejnīca'), devices_total: 0, alerts_open: 0 }]) }),
});

describe('устройства', () => {
  it('список: фильтры уходят в запрос; новое устройство — тело по контракту, пустые поля — null; 409 — сообщение сервера', async () => {
    let n = 0;
    const calls = fakeApi({
      ...base('admin'),
      'GET /devices': () => ({ status: 200, body: page([listItem]) }),
      'POST /devices': () => (n++ === 0
        ? { status: 409, body: { type: 'x', title: 'Conflict', status: 409, detail: 'Device ID уже занят' } }
        : { status: 201, body: device }),
    });
    const u = userEvent.setup();
    renderAt('/devices');
    expect(await screen.findByRole('link', { name: 'SN-001' })).toHaveAttribute('href', `/devices/${D1}`);
    expect(within(screen.getByRole('link', { name: 'SN-001' }).closest('tr')!).getByText('Offline')).toBeInTheDocument();
    await u.click(screen.getByRole('textbox', { name: 'Lifecycle' }));
    await u.click(await screen.findByRole('option', { name: 'Installed', hidden: true }));
    await waitFor(() => expect(calls.some((c) => c.path.startsWith('/devices?') && c.path.includes('lifecycle=installed') && c.path.includes('sort=-created_at'))).toBe(true));
    await u.click(within(screen.getByRole('group', { name: 'State' })).getByRole('button', { name: 'Warning' }));
    await waitFor(() => expect(calls.some((c) => c.path.includes('state=warning'))).toBe(true));
    await u.click(within(screen.getByRole('group', { name: 'State' })).getByRole('button', { name: 'All' }));
    await waitFor(() => expect(calls.at(-1)!.path).not.toContain('state='));
    await u.click(screen.getByRole('textbox', { name: 'Alert type' }));
    await u.click(await screen.findByRole('option', { name: 'Filter low', hidden: true }));
    await u.type(screen.getByRole('textbox', { name: 'Filter left ≤ %' }), '20');
    await waitFor(() => expect(calls.some((c) => c.path.includes('alert_type=filter_low') && c.path.includes('filter_left_max_pct=20'))).toBe(true));
    await u.click(screen.getByRole('button', { name: 'New device' }));
    const dlg = await screen.findByRole('dialog');
    await u.type(within(dlg).getByLabelText(/Device ID/), 'cooler-002');
    await u.type(within(dlg).getByLabelText(/Serial number/), ' SN-002 ');
    await u.click(within(dlg).getByRole('button', { name: 'New device' }));
    expect(await screen.findByText('Device ID уже занят')).toBeInTheDocument();
    await u.click(within(dlg).getByRole('button', { name: 'New device' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = calls.filter((c) => c.method === 'POST' && c.path === '/devices').at(-1)!;
    expect(post.body).toEqual({ device_id: 'cooler-002', serial: 'SN-002', imei: null, hw: null, description: null, ownership: 'purchase',
      model: { water_source: 'mains', variant: 'A', carbonated: false, sku: null } });
  });

  it('Exec — только просмотр: ни создания, ни изменения, ни переноса', async () => {
    fakeApi({ ...base('exec'), 'GET /devices': () => ({ status: 200, body: page([listItem]) }), 'GET /devices/:id': () => ({ status: 200, body: card }),
      'GET /devices/:id/history': () => ({ status: 200, body: page([]) }) });
    renderAt('/devices');
    await screen.findByRole('link', { name: 'SN-001' });
    expect(screen.queryByRole('button', { name: 'New device' })).toBeNull();
    renderAt(`/devices/${D1}`);
    expect(await screen.findByRole('heading', { name: 'Identity' })).toBeInTheDocument(); // карточка загружена
    for (const b of ['Edit', 'Move', 'Change lifecycle', 'Change ownership']) expect(screen.queryByRole('button', { name: b })).toBeNull();
  });

  it('карточка: «не выходило на связь»; перенос к клиенту и его адресу с комментарием; история с именами', async () => {
    const calls = fakeApi({
      ...base('tech'),
      'GET /devices/:id': () => ({ status: 200, body: card }),
      'GET /devices/:id/history': () => ({ status: 200, body: page([{ at: '2026-11-02T10:00:00Z', by: null, field: 'client', before: null, after: C1, comment: 'монтаж' }]) }),
      'GET /clients/:id': () => ({ status: 200, body: { ...client(C2, 'Kafejnīca'), addresses: [{ id: A2, client_id: C2, address: 'Tērbatas 2', floor: '1', place: 'Bārs' }], contacts: [], devices: [] } }),
      'POST /devices/:id/transfer': () => ({ status: 200, body: { ...device, client_id: C2, address_id: A2 } }),
    });
    const u = userEvent.setup();
    renderAt(`/devices/${D1}`);
    expect(await screen.findByText(/Has not connected yet\./)).toBeInTheDocument();
    const hist = (await screen.findByText('монтаж')).closest('tr')!;
    expect(within(hist).getByText('No client (stock)')).toBeInTheDocument();
    expect(within(hist).getByText('SIA Birojs')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Move' }));
    const dlg = await screen.findByRole('dialog');
    await u.click(within(dlg).getByRole('textbox', { name: 'Client' }));
    await u.click(await screen.findByRole('option', { name: 'Kafejnīca', hidden: true }));
    await u.click(within(dlg).getByRole('textbox', { name: 'Address' }));
    await u.click(await screen.findByRole('option', { name: 'Tērbatas 2, Floor 1, Bārs', hidden: true }));
    await u.type(within(dlg).getByLabelText('Comment'), 'переезд');
    await u.click(within(dlg).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ client_id: C2, address_id: A2, comment: 'переезд' }));
  });

  it('на склад: клиент снят — адрес не уходит', async () => {
    const calls = fakeApi({ ...base('admin'), 'GET /devices/:id': () => ({ status: 200, body: { ...card, address_id: A2 } }),
      'GET /devices/:id/history': () => ({ status: 200, body: page([]) }),
      'GET /clients/:id': () => ({ status: 200, body: { ...client(C1, 'SIA Birojs'), addresses: [], contacts: [], devices: [] } }),
      'POST /devices/:id/transfer': () => ({ status: 200, body: device }) });
    const u = userEvent.setup();
    renderAt(`/devices/${D1}`);
    await u.click(await screen.findByRole('button', { name: 'Move' }));
    const dlg = await screen.findByRole('dialog');
    await u.click(within(dlg).getByRole('textbox', { name: 'Client' }));
    await u.click(await screen.findByRole('option', { name: 'No client (stock)', hidden: true }));
    await u.click(within(dlg).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ client_id: null, address_id: null, comment: null }));
  });

  it('жизненный цикл — PUT с комментарием', async () => {
    const calls = fakeApi({ ...base('admin'), 'GET /devices/:id': () => ({ status: 200, body: card }), 'GET /devices/:id/history': () => ({ status: 200, body: page([]) }),
      'PUT /devices/:id/lifecycle': () => ({ status: 200, body: { ...device, lifecycle: 'installed' } }) });
    const u = userEvent.setup();
    renderAt(`/devices/${D1}`);
    await u.click(await screen.findByRole('button', { name: 'Change lifecycle' }));
    const dlg = await screen.findByRole('dialog');
    await u.click(within(dlg).getByRole('textbox', { name: 'Lifecycle' }));
    await u.click(await screen.findByRole('option', { name: 'Installed', hidden: true }));
    await u.type(within(dlg).getByLabelText('Comment'), 'смонтирован');
    await u.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ path: `/devices/${D1}/lifecycle`, body: { lifecycle: 'installed', comment: 'смонтирован' } }));
  });

  it('перенос: пока адреса клиента грузятся или не загрузились — сохранить нельзя; повтор загружает', async () => {
    let fail = true;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    // устройство на складе: адреса грузятся только для выбранного клиента
    const calls = fakeApi({ ...base('admin'), 'GET /devices/:id': () => ({ status: 200, body: { ...card, client: null, client_id: null } }), 'GET /devices/:id/history': () => ({ status: 200, body: page([]) }),
      'GET /clients/:id': async () => {
        await gate;
        if (fail) { fail = false; return { status: 500, body: { type: 'x', title: 'Server Error', status: 500 } }; }
        return { status: 200, body: { ...client(C2, 'Kafejnīca'), addresses: [{ id: A2, client_id: C2, address: 'Tērbatas 2' }], contacts: [], devices: [] } };
      } });
    const u = userEvent.setup();
    renderAt(`/devices/${D1}`);
    await u.click(await screen.findByRole('button', { name: 'Move' }));
    const dlg = await screen.findByRole('dialog');
    await u.click(within(dlg).getByRole('textbox', { name: 'Client' }));
    await u.click(await screen.findByRole('option', { name: 'Kafejnīca', hidden: true }));
    expect(within(dlg).getByRole('button', { name: 'Move' })).toBeDisabled(); // грузятся
    release();
    expect(await within(dlg).findByText('Could not load the client’s addresses')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Move' })).toBeDisabled(); // ошибка
    await u.click(within(dlg).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Move' })).toBeEnabled());
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('аренда/покупка — PUT ownership с комментарием', async () => {
    const calls = fakeApi({ ...base('admin'), 'GET /devices/:id': () => ({ status: 200, body: card }), 'GET /devices/:id/history': () => ({ status: 200, body: page([]) }),
      'PUT /devices/:id/ownership': () => ({ status: 200, body: { ...device, ownership: 'rent' } }) });
    const u = userEvent.setup();
    renderAt(`/devices/${D1}`);
    await u.click(await screen.findByRole('button', { name: 'Change ownership' }));
    const dlg = await screen.findByRole('dialog');
    await u.click(within(dlg).getByRole('textbox', { name: 'Ownership' }));
    await u.click(await screen.findByRole('option', { name: 'Rent', hidden: true }));
    await u.type(within(dlg).getByLabelText('Comment'), 'договор аренды');
    await u.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ path: `/devices/${D1}/ownership`, body: { ownership: 'rent', comment: 'договор аренды' } }));
  });

  it('несуществующее устройство и не UUID — «не найдено»', async () => {
    fakeApi({ ...base('admin'), 'GET /devices/:id': () => ({ status: 404, body: { type: 'x', title: 'Not Found', status: 404 } }) });
    renderAt(`/devices/${D1}`);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('адрес карточки не UUID — «не найдено» без запроса', async () => {
    const calls = fakeApi({ ...base('admin') });
    renderAt('/devices/abc');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/devices'))).toBe(false);
  });
});

describe('клиенты', () => {
  const clientCard = { ...client(C1, 'SIA Birojs'), addresses: [{ id: A2, client_id: C1, address: 'Brīvības 1', region: 'Rīga', lat: 56.95, lng: 24.11, coords_source: 'geocoded', floor: '3', place: 'Kitchen', access_note: 'Code 1234 at the gate' }],
    contacts: [{ id: 'k0000000-0000-4000-8000-000000000001', client_id: C1, name: 'Jānis', phone: '+371 20000000', email: null, role: 'Office manager', comment: null }], devices: [listItem] };

  it('создание — тело по контракту и переход в карточку; карточка — адреса, контакты, кулеры', async () => {
    const calls = fakeApi({ ...base('admin'), 'POST /clients': () => ({ status: 201, body: client(C1, 'SIA Birojs') }), 'GET /clients/:id': () => ({ status: 200, body: clientCard }) });
    const u = userEvent.setup();
    renderAt('/clients');
    await screen.findByRole('link', { name: 'SIA Birojs' });
    await u.click(screen.getByRole('button', { name: 'New client' }));
    const dlg = await screen.findByRole('dialog');
    await u.type(within(dlg).getByLabelText(/^Name/), 'SIA Birojs');
    await u.type(within(dlg).getByLabelText('Registration number'), '40003000000');
    await u.click(within(dlg).getByRole('button', { name: 'New client' }));
    expect(await screen.findByRole('heading', { name: 'SIA Birojs' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ type: 'organization', name: 'SIA Birojs', reg_number: '40003000000', legal_address: null });
    expect(screen.getByText('Brīvības 1')).toBeInTheDocument();
    expect(screen.getByText('Rīga · Floor 3 · Kitchen')).toBeInTheDocument();
    expect(screen.getByText(/56\.95000, 24\.11000 \(found by address\)/)).toBeInTheDocument();
    expect(screen.getByText('Jānis')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SN-001' })).toBeInTheDocument();
  });

  it('адрес: без координат — lat/lng null (найдёт сервер); одна координата — ошибка формы; обе — manual', async () => {
    const calls = fakeApi({ ...base('admin'), 'GET /clients/:id': () => ({ status: 200, body: clientCard }),
      'POST /clients/:id/addresses': () => ({ status: 201, body: clientCard.addresses[0] }) });
    const u = userEvent.setup();
    renderAt(`/clients/${C1}`);
    await u.click(await screen.findByRole('button', { name: 'Add address' }));
    let dlg = await screen.findByRole('dialog');
    await u.type(within(dlg).getByLabelText(/^Address/), 'Tērbatas 2');
    await u.type(within(dlg).getByLabelText(/^Floor/), '1');
    await u.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ address: 'Tērbatas 2', region: null, floor: '1', place: null, access_note: null, lat: null, lng: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await u.click(screen.getByRole('button', { name: 'Add address' }));
    dlg = await screen.findByRole('dialog');
    await u.type(within(dlg).getByLabelText(/^Address/), 'X');
    await u.type(within(dlg).getByLabelText('Latitude'), '57');
    await u.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findAllByText('Leave empty to find by address')).toHaveLength(3); // подсказка + ошибки двух полей
    await u.type(within(dlg).getByLabelText('Longitude'), '25');
    await u.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST')[1]!.body).toMatchObject({ address: 'X', lat: 57, lng: 25, coords_source: 'manual' });
  });

  it('удаление клиента с устройствами — сообщение сервера (409), остаёмся в карточке', async () => {
    fakeApi({ ...base('admin'), 'GET /clients/:id': () => ({ status: 200, body: clientCard }),
      'DELETE /clients/:id': () => ({ status: 409, body: { type: 'x', title: 'Conflict', status: 409, detail: 'У клиента 1 устройств — сначала перенесите их' } }) });
    const u = userEvent.setup();
    renderAt(`/clients/${C1}`);
    await u.click((await screen.findAllByRole('button', { name: 'Delete' }))[0]!);
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/сначала перенесите/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'SIA Birojs' })).toBeInTheDocument();
  });

  it('Exec — карточка без кнопок изменения, но с комментарием о доступе', async () => {
    fakeApi({ ...base('exec'), 'GET /clients/:id': () => ({ status: 200, body: clientCard }) });
    renderAt(`/clients/${C1}`);
    await screen.findByRole('heading', { name: 'SIA Birojs' });
    expect(screen.getByText('Access note: Code 1234 at the gate')).toBeInTheDocument();
    for (const b of ['Edit', 'Delete', 'Add address', 'Add contact']) expect(screen.queryByRole('button', { name: b })).toBeNull();
  });
});

describe('карта', () => {
  it('рамка — в формате контракта и в пределах координат', () => {
    expect(bboxOf(L.latLngBounds([[-95, -200], [95, 200]]))).toBe('-180.00000,-90.00000,180.00000,90.00000');
    expect(bboxOf(L.latLngBounds([[56.9, 24.0], [57, 24.2]]))).toBe('24.00000,56.90000,24.20000,57.00000');
  });

  it('кулеры одного адреса — одной группой', () => {
    const p = (id: string, lat: number) => ({ id, lat, lng: 24, color: 'grey' as const, alerts_open: 0 });
    expect(groupByPoint([p('a', 1), p('b', 1), p('c', 2)]).map((g) => g.map((x) => x.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('запрос с рамкой и масштабом; кластер — число; один адрес — список с этажом и местом и ссылкой', async () => {
    const calls = fakeApi({ ...base('admin'), 'GET /map': () => ({ status: 200, body: {
      clusters: [{ lat: 56.5, lng: 21, count: 12, by_color: { grey: 12 } }],
      devices: [
        { id: D1, lat: 56.95, lng: 24.1, color: 'grey', client_name: 'SIA Birojs', address: 'Brīvības 1', floor: '1', place: 'Reception', alerts_open: 0, filter_left_pct: null },
        { id: 'd0000000-0000-4000-8000-000000000002', lat: 56.95, lng: 24.1, color: 'grey', client_name: 'SIA Birojs', address: 'Brīvības 1', floor: '3', place: 'Kitchen', alerts_open: 0, filter_left_pct: null },
      ] } }) });
    const u = userEvent.setup();
    renderAt('/map');
    expect(await screen.findByRole('button', { name: '12 — Zoom in' })).toBeInTheDocument();
    const q = new URLSearchParams(calls.find((c) => c.path.startsWith('/map'))!.path.split('?')[1]);
    expect(q.get('zoom')).toBe('7');
    expect(q.get('bbox')).toMatch(/^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$/);
    // значки — цветные круги: стиль разобран браузером, а не потерян
    const dotEl = screen.getByRole('button', { name: '2 — Brīvības 1' }).querySelector('span')!;
    expect(dotEl.style.background).toMatch(/rgb\(134, 142, 150\)|#868e96/);
    expect(dotEl.style.borderRadius).toBe('50%');
    expect(screen.getByRole('button', { name: '12 — Zoom in' }).querySelector('span')!.style.width).toBe('36px');
    await u.click(screen.getByRole('button', { name: '2 — Brīvības 1' }));
    expect(await screen.findByRole('heading', { name: 'Coolers at this address' })).toBeInTheDocument();
    expect(screen.getByText('Floor 1 · Reception')).toBeInTheDocument();
    expect(screen.getByText('Floor 3 · Kitchen')).toBeInTheDocument();
    expect(screen.getAllByText('Filter left: —')).toHaveLength(2); // нет данных — так и показано
    expect(screen.getAllByRole('link', { name: 'Open device' })[0]).toHaveAttribute('href', `/devices/${D1}`);
  });

  it('фильтры уходят в запрос карты; смена фильтра закрывает панель прежнего выбора', async () => {
    const pin = { id: D1, lat: 56.95, lng: 24.1, color: 'grey', client_name: 'SIA Birojs', address: 'Brīvības 1', floor: '1', place: 'Reception', alerts_open: 0, filter_left_pct: 42 };
    const calls = fakeApi({ ...base('admin'), 'GET /map': () => ({ status: 200, body: { clusters: [], devices: [pin] } }) }); // устройство и после смены фильтра в ответе — панель закрывает именно смена
    const u = userEvent.setup();
    renderAt('/map');
    await waitFor(() => expect(calls.some((c) => c.path.startsWith('/map'))).toBe(true));
    await u.click(await screen.findByRole('button', { name: 'SIA Birojs, Brīvības 1, 1, Reception' }));
    expect(await screen.findByText('Filter left: 42 %')).toBeInTheDocument();
    const states = screen.getByRole('group', { name: 'State' });
    await u.click(within(states).getByRole('button', { name: 'Fault' }));
    expect(within(states).getByRole('button', { name: 'Fault' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(calls.some((c) => c.path.startsWith('/map') && c.path.includes('state=fault'))).toBe(true));
    await waitFor(() => expect(screen.queryByText('Filter left: 42 %')).toBeNull());
    await u.click(screen.getByRole('textbox', { name: 'Alert type' }));
    await u.click((await screen.findAllByRole('option', { name: 'Offline', hidden: true })).at(-1)!); // последний открытый список
    await u.type(screen.getByRole('textbox', { name: 'Filter left ≤ %' }), '5');
    await waitFor(() => expect(calls.some((c) => c.path.includes('alert_type=offline') && c.path.includes('filter_left_max_pct=5'))).toBe(true));
  });
});

describe('карта по ссылке из карточки устройства', () => {
  it('?lat&lng — карта открывается на точке крупным масштабом; кнопка в карточке ведёт туда', async () => {
    const calls = fakeApi({ ...base('admin'), 'GET /map': () => ({ status: 200, body: { clusters: [], devices: [] } }),
      'GET /devices/:id': () => ({ status: 200, body: { ...card, address_detail: { id: A2, client_id: C1, address: 'Brīvības 1', lat: 56.95, lng: 24.11 } } }),
      'GET /devices/:id/history': () => ({ status: 200, body: page([]) }) });
    renderAt(`/devices/${D1}`);
    expect(await screen.findByRole('link', { name: 'Show on map' })).toHaveAttribute('href', '/map?lat=56.95&lng=24.11');
    renderAt('/map?lat=56.95&lng=24.11');
    await waitFor(() => expect(calls.some((c) => c.path.startsWith('/map?') && new URLSearchParams(c.path.split('?')[1]).get('zoom') === '17')).toBe(true));
    // рамка — вокруг точки
    const [w, so, e, n] = new URLSearchParams(calls.filter((c) => c.path.startsWith('/map?')).at(-1)!.path.split('?')[1]).get('bbox')!.split(',').map(Number);
    expect(w! <= 24.11 && 24.11 <= e! && so! <= 56.95 && 56.95 <= n!).toBe(true);
  });

  it.each(['/map?lat=56.95', '/map?lat=56.95&lng=', '/map?lat=%20&lng=24', '/map?lat=95&lng=24', '/map?lat=abc&lng=24'])('%s — без точки: обзорный масштаб', async (url) => {
    const calls = fakeApi({ ...base('admin'), 'GET /map': () => ({ status: 200, body: { clusters: [], devices: [] } }) });
    renderAt(url);
    await waitFor(() => expect(calls.some((c) => c.path.startsWith('/map?'))).toBe(true));
    expect(new URLSearchParams(calls.find((c) => c.path.startsWith('/map?'))!.path.split('?')[1]).get('zoom')).toBe('7');
  });

  it('телефон: панель фильтров свёрнута, открывается и закрывается', async () => {
    const prev = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...prev(q), matches: q.includes('max-width: 640px') })) as typeof window.matchMedia;
    try {
      fakeApi({ ...base('admin'), 'GET /map': () => ({ status: 200, body: { clusters: [], devices: [] } }) });
      const u = userEvent.setup();
      renderAt('/map');
      await u.click(await screen.findByRole('button', { name: 'Filters' }));
      expect(screen.getByRole('group', { name: 'State' })).toBeInTheDocument();
      await u.click(screen.getByRole('button', { name: 'Hide filters' }));
      expect(screen.queryByRole('group', { name: 'State' })).toBeNull();
    } finally { window.matchMedia = prev; }
  });
});

describe('строки таблиц', () => {
  it('нажатие на строку — карточка устройства; ссылка клиента в строке — карточка клиента', async () => {
    fakeApi({ ...base('admin'), 'GET /devices': () => ({ status: 200, body: page([listItem]) }), 'GET /devices/:id': () => ({ status: 200, body: card }),
      'GET /devices/:id/history': () => ({ status: 200, body: page([]) }),
      'GET /clients/:id': () => ({ status: 200, body: { ...client(C1, 'SIA Birojs'), addresses: [], contacts: [], devices: [] } }) });
    const u = userEvent.setup();
    renderAt('/devices');
    const row = (await screen.findByRole('link', { name: 'SN-001' })).closest('tr')!;
    await u.click(within(row).getByText('Offline'));
    expect(await screen.findByRole('heading', { name: 'Identity' })).toBeInTheDocument();
    await u.click(screen.getByRole('link', { name: '‹ Devices' })); // назад из карточки
    const row2 = (await screen.findByRole('link', { name: 'SN-001' })).closest('tr')!;
    expect(within(row2).getByRole('link', { name: 'SIA Birojs' })).toHaveAttribute('href', `/clients/${C1}`);
    await u.click(within(row2).getByRole('link', { name: 'SIA Birojs' }));
    expect(await screen.findByRole('heading', { name: 'Installation addresses' })).toBeInTheDocument();
  });
});
