// Реестр устройств (§4.2): список с поиском, фильтрами и сортировкой, создание (V-010), карточка устройства —
// идентификаторы и модель, клиент и адрес, перенос (V-014), жизненный цикл и аренда/покупка (V-013, P-09), история.
// Состояние (online, тех. состояние, прошивка, фильтр, алерты) приходит от устройства — до первой связи его нет.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Alert, Anchor, Badge, Button, Card, Checkbox, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconArrowsSort, IconDroplet, IconFilter, IconFlame, IconMapPin, IconPencil, IconPlus, IconSearch, IconSnowflake } from '@tabler/icons-react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, ok, type Schemas } from '../api/client';
import { useSession } from '../auth/session';
import { can } from '../api/roles';
import { en, t, tx } from '../i18n';
import { applyErrors, fmt, LoadError, notifyOk, PageTitle } from './common';
import { NotFound } from './misc';
import { useClientOptions } from './end-users';

type Device = Schemas['Device'];
type ListItem = Schemas['DeviceListItem'];
type Card = Schemas['DeviceCard'];
type Model = Schemas['DeviceModel'];
type Lifecycle = Schemas['LifecycleStatus'];
type Ownership = Schemas['Ownership'];

const opts = (group: Record<string, string>) => Object.entries(group).map(([value, label]) => ({ value, label }));
export const LIFECYCLE_OPTS = opts(en.devices.lifecycles);
export const STATE_OPTS = opts(en.devices.states);
export const OWNERSHIP_OPTS = opts(en.devices.ownerships);
const WATER_OPTS = opts(en.devices.waterSources);
const SORT_OPTS = opts(en.devices.sorts);
export const ALERT_OPTS = opts(en.devices.alertTypes);
const STATE_CLASS: Record<string, string> = { operational: 'ok', warning: 'warn', fault: 'crit', offline: 'off' };
export const STATE_DOT: Record<string, string> = { operational: 'var(--ok)', warning: 'var(--warn)', fault: 'var(--crit)', offline: 'var(--off)' };

/** '' → null: пустое необязательное поле формы уходит в API как «нет значения». */
export const orNull = (v: string): string | null => (v.trim() ? v.trim() : null);

export function StateBadge({ d }: { d: Pick<Device, 'state' | 'last_seen_at'> }) {
  const never = d.state === 'offline' && !d.last_seen_at;
  return <span className={`ic-badge ${STATE_CLASS[d.state]}`} title={never ? t('devices.neverSeen') : undefined}>{tx(en.devices.states, d.state)}</span>;
}

export const modelLabel = (m: Model): string =>
  [tx(en.devices.waterSources, m.water_source), m.variant, m.carbonated ? 'CO₂' : null, m.sku].filter(Boolean).join(' · ');

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} %`);
/** Место у клиента — коротко, как в демо: «Reception», иначе этаж, иначе адрес. */
const spotOf = (d: Pick<ListItem, 'address' | 'floor' | 'place'>) =>
  d.place ?? (d.floor ? `${t('clients.floor')} ${d.floor}` : d.address) ?? t('devices.stock');

/** Таблица устройств как в демо: устройство (клиент · место · серийник), модель, владение, статус, показатели. */
export function DeviceTable({ items, showClient = true }: { items: ListItem[]; showClient?: boolean }) {
  const navigate = useNavigate();
  return (
    <Table.ScrollContainer minWidth={980}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('devices.device')}</Table.Th><Table.Th>{t('devices.model')}</Table.Th><Table.Th>{t('devices.ownership')}</Table.Th>
            <Table.Th>{t('devices.state')}</Table.Th><Table.Th>{t('devices.lifecycle')}</Table.Th><Table.Th>{t('devices.filter')}</Table.Th>
            <Table.Th>{t('devices.liters')}</Table.Th><Table.Th>{t('devices.fw')}</Table.Th><Table.Th>{t('devices.lastSeen')}</Table.Th>
            <Table.Th>{t('devices.alerts')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((d) => (
            <Table.Tr key={d.id} data-href={`/devices/${d.id}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) void navigate(`/devices/${d.id}`); }}>
              <Table.Td style={{ minWidth: 230 }}>
                <div className="ic-primary">
                  {showClient && d.client_id ? <Anchor component={Link} to={`/clients/${d.client_id}`} c="inherit" fw={600}>{d.client_name}</Anchor>
                    : showClient ? t('devices.stock') : spotOf(d)}
                </div>
                <div className="ic-secondary">
                  {showClient ? (d.client_name ? `${spotOf(d)} · ` : '') : d.address ? `${d.address} · ` : ''}
                  <Anchor component={Link} to={`/devices/${d.id}`} className="ic-mono" c="inherit">{d.serial}</Anchor>
                </div>
              </Table.Td>
              <Table.Td style={{ minWidth: 170 }}>
                <div className="ic-primary" style={{ fontWeight: 560 }}>{tx(en.devices.waterSources, d.model.water_source)} · {d.model.variant}{d.model.carbonated ? ' · CO₂' : ''}</div>
                <div className="ic-mono">{d.model.sku ?? d.device_id}</div>
              </Table.Td>
              <Table.Td><span className="ic-badge outline">{tx(en.devices.ownerships, d.ownership)}</span></Table.Td>
              <Table.Td><StateBadge d={d} /></Table.Td>
              <Table.Td>{tx(en.devices.lifecycles, d.lifecycle)}</Table.Td>
              <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(d.filter_left_pct)}</Table.Td>
              <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{d.liters_period == null ? '—' : `${d.liters_period.toFixed(1)} L`}</Table.Td>
              <Table.Td><span className="ic-mono" style={{ color: 'var(--text)' }}>{d.fw ?? '—'}</span></Table.Td>
              <Table.Td style={{ whiteSpace: 'nowrap' }}>{d.last_seen_at ? fmt(d.last_seen_at) : <span className="ic-secondary">{t('common.never')}</span>}</Table.Td>
              <Table.Td>{d.alerts_open ? <span className="ic-badge crit plain">{d.alerts_open}</span> : <span className="ic-secondary">0</span>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

export function DevicesPage() {
  const qc = useQueryClient();
  const { role } = useSession();
  const clients = useClientOptions();
  const [q, setQ] = useState('');
  const [f, setF] = useState<Record<string, string | null>>({ sort: '-created_at' });
  const [creating, setCreating] = useState(false);
  const set = (k: string) => (v: string | null) => setF((x) => ({ ...x, [k]: v }));
  const query = Object.fromEntries(Object.entries({ ...f, q: q.trim() }).filter(([, v]) => v));
  const list = useInfiniteQuery({
    queryKey: ['devices', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => ok(api.GET('/devices', { params: { query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) } as never } })),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const stateChips = [{ value: null as string | null, label: t('common.all'), dot: null as string | null },
    ...STATE_OPTS.map((o) => ({ value: o.value as string | null, label: o.label, dot: STATE_DOT[o.value]! }))];
  return (
    <Stack gap={0}>
      <PageTitle sub={list.isSuccess ? `${items.length}${list.hasNextPage ? '+' : ''} ${t('devices.shown')}` : ' '}
        right={can(role, 'createDevice') && <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>{t('devices.create')}</Button>}>
        {t('devices.title')}
      </PageTitle>
      <div className="ic-card">
        <Stack gap="sm" p="md" pb="sm">
          <Group gap="sm">
            <TextInput placeholder={t('devices.searchHint')} aria-label={t('common.search')} leftSection={<IconSearch size={16} />} value={q}
              onChange={(e) => setQ(e.currentTarget.value)} style={{ flex: '1 1 280px' }} />
            <Select placeholder={t('devices.allClients')} aria-label={t('devices.client')} data={clients.data ?? []} value={f['client_id'] ?? null} onChange={set('client_id')} searchable clearable w={190} />
            <Select placeholder={t('devices.allModels')} aria-label={t('devices.waterSource')} data={WATER_OPTS} value={f['model'] ?? null} onChange={set('model')} clearable w={170} />
            <Select placeholder={t('devices.allOwnership')} aria-label={t('devices.ownership')} data={OWNERSHIP_OPTS} value={f['ownership'] ?? null} onChange={set('ownership')} clearable w={170} />
            <TextInput placeholder={t('devices.allRegions')} aria-label={t('clients.region')} value={f['region'] ?? ''} onChange={(e) => set('region')(e.currentTarget.value.trim() || null)} w={150} />
          </Group>
          <Group gap="sm">
            <Select placeholder={t('devices.allLifecycles')} aria-label={t('devices.lifecycle')} data={LIFECYCLE_OPTS} value={f['lifecycle'] ?? null} onChange={set('lifecycle')} clearable w={170} />
            <Select placeholder={t('devices.allAlerts')} aria-label={t('devices.alertType')} data={ALERT_OPTS} value={f['alert_type'] ?? null} onChange={set('alert_type')} clearable w={170} />
            <NumberInput placeholder={t('devices.filterMax')} aria-label={t('devices.filterMax')} min={0} max={100} w={150} value={f['filter_left_max_pct'] ?? ''}
              onChange={(v) => set('filter_left_max_pct')(v === '' ? null : String(v))} />
            <Select aria-label={t('devices.sort')} leftSection={<IconArrowsSort size={16} />} data={SORT_OPTS} value={f['sort'] ?? '-created_at'} onChange={set('sort')} allowDeselect={false} w={190} />
          </Group>
          <div className="ic-chips" role="group" aria-label={t('devices.state')}>
            {stateChips.map((c) => (
              <button key={c.label} type="button" className="ic-chip" aria-pressed={(f['state'] ?? null) === c.value} onClick={() => set('state')(c.value)}>
                {c.dot && <span className="dot" style={{ background: c.dot }} />}{c.label}
              </button>
            ))}
          </div>
        </Stack>
        <DeviceTable items={items} />
        <Stack p="md" pt={items.length ? 'md' : 0} gap="sm">
          {list.isSuccess && !items.length && <Text c="dimmed">{t('devices.empty')}</Text>}
          {list.isError && !list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.refetch()} />}
          {list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.fetchNextPage()} />}
          {list.isPending && <Text c="dimmed">{t('common.loading')}</Text>}
          {list.hasNextPage && <Group><Button variant="default" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t('common.loadMore')}</Button></Group>}
        </Stack>
      </div>
      {creating && <DeviceModal onClose={() => setCreating(false)} onDone={() => qc.invalidateQueries({ queryKey: ['devices'] })} />}
    </Stack>
  );
}

/** Создание (без device) и изменение (с device) — одна форма. Device ID после создания не меняется. */
function DeviceModal({ device, onClose, onDone }: { device?: Device; onClose: () => void; onDone: () => unknown }) {
  const form = useForm({
    initialValues: {
      device_id: device?.device_id ?? '', serial: device?.serial ?? '', imei: device?.imei ?? '', hw: device?.hw ?? '',
      description: device?.description ?? '', ownership: device?.ownership ?? 'purchase',
      water_source: device?.model.water_source ?? 'mains', variant: device?.model.variant ?? 'A',
      carbonated: device?.model.carbonated ?? false, sku: device?.model.sku ?? '',
    },
  });
  const rename = { 'model/water_source': 'water_source', 'model/variant': 'variant', 'model/sku': 'sku' };
  return (
    <Modal opened onClose={onClose} title={device ? `${t('common.edit')}: ${device.serial}` : t('devices.create')} centered size="lg">
      <form onSubmit={form.onSubmit(async (v) => {
        const model = { water_source: v.water_source as Model['water_source'], variant: v.variant as Model['variant'], carbonated: v.carbonated, sku: orNull(v.sku) };
        const common = { serial: v.serial.trim(), imei: orNull(v.imei), hw: orNull(v.hw), description: orNull(v.description), model };
        try {
          if (device) await ok(api.PATCH('/devices/{deviceId}', { params: { path: { deviceId: device.id } }, body: common }));
          else await ok(api.POST('/devices', { body: { ...common, device_id: v.device_id.trim(), ownership: v.ownership as Ownership } }));
          notifyOk(); onClose(); void onDone();
        } catch (e) { applyErrors(form, e, rename); }
      })}>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label={t('devices.deviceId')} required disabled={!!device} {...form.getInputProps('device_id')} />
            <TextInput label={t('devices.serial')} required {...form.getInputProps('serial')} />
            <TextInput label={t('devices.imei')} inputMode="numeric" {...form.getInputProps('imei')} />
            <TextInput label={t('devices.hw')} {...form.getInputProps('hw')} />
            <Select label={t('devices.waterSource')} data={WATER_OPTS} allowDeselect={false} {...form.getInputProps('water_source')} />
            <Select label={t('devices.variant')} data={['A', 'S']} allowDeselect={false} {...form.getInputProps('variant')} />
            <TextInput label={t('devices.sku')} {...form.getInputProps('sku')} />
            {!device && <Select label={t('devices.ownership')} data={OWNERSHIP_OPTS} allowDeselect={false} {...form.getInputProps('ownership')} />}
          </SimpleGrid>
          <Checkbox label={t('devices.carbonated')} {...form.getInputProps('carbonated', { type: 'checkbox' })} />
          <Textarea label={t('devices.description')} autosize minRows={2} {...form.getInputProps('description')} />
          <Group justify="flex-end"><Button type="submit" loading={form.submitting}>{device ? t('common.save') : t('devices.create')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function DevicePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { role } = useSession();
  const [modal, setModal] = useState<'edit' | 'transfer' | 'lifecycle' | 'ownership' | null>(null);
  const card = useQuery({
    queryKey: ['device', id], enabled: UUID.test(id),
    queryFn: () => ok(api.GET('/devices/{deviceId}', { params: { path: { deviceId: id } } })),
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['device', id] }), qc.invalidateQueries({ queryKey: ['device-history', id] }), qc.invalidateQueries({ queryKey: ['devices'] })]);
  if (!UUID.test(id) || (card.error instanceof ApiError && card.error.status === 404)) return <NotFound />;
  if (card.isError) return <LoadError error={card.error} retry={() => card.refetch()} />;
  if (!card.data) return <Text c="dimmed">{t('common.loading')}</Text>;
  const d = card.data;
  const editable = can(role, 'updateDevice');
  const a = d.address_detail;
  const cur = d.current;
  const temp = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));
  const set = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} °C`);
  return (
    <Stack gap="md">
      <PageTitle
        back={<Group gap={6} mb={8} className="ic-secondary"><Anchor component={Link} to="/devices" c="dimmed" size="sm">‹ {t('devices.title')}</Anchor>
          {d.client && <span>/ {d.client.name}</span>}</Group>}
        eyebrow={`${modelLabel(d.model)} · ${tx(en.devices.ownerships, d.ownership)}`}
        sub={<Group gap={8} mt={4}><StateBadge d={d} />{!d.last_seen_at && <span className="ic-badge off plain">{t('devices.neverSeen')}</span>}
          {d.blocked && <span className="ic-badge crit plain">{t('devices.blocked')}</span>}<span className="ic-mono">{d.serial}</span></Group>}
        right={
          <Group gap="xs">
            {a?.lat != null && a.lng != null && <Button variant="default" leftSection={<IconMapPin size={16} />} component={Link} to={`/map?lat=${a.lat}&lng=${a.lng}`}>{t('devices.showOnMap')}</Button>}
            {can(role, 'transferDevice') && <Button variant="default" onClick={() => setModal('transfer')}>{t('devices.transfer')}</Button>}
            {can(role, 'setLifecycle') && <Button variant="default" onClick={() => setModal('lifecycle')}>{t('devices.changeLifecycle')}</Button>}
            {can(role, 'setOwnership') && <Button variant="default" onClick={() => setModal('ownership')}>{t('devices.changeOwnership')}</Button>}
            {editable && <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setModal('edit')}>{t('common.edit')}</Button>}
          </Group>
        }>
        {d.client ? <>{d.client.name}{a?.place || a?.floor ? <span className="ic-title-muted"> · {a.place ?? `${t('clients.floor')} ${a.floor}`}</span> : null}</> : d.serial}
      </PageTitle>
      {!d.last_seen_at && <Alert color="gray" variant="light">{t('devices.neverSeen')}. {t('devices.liveNote')}</Alert>}
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Kpi label={t('devices.kpi.cold')} icon={<IconSnowflake size={16} color="var(--cold)" />} tint="var(--cold-soft)" value={temp(cur?.t_cold)} unit="°C" foot={`${t('devices.kpi.setpoint')} ${set(cur?.t_cold_set)}`} />
        <Kpi label={t('devices.kpi.hot')} icon={<IconFlame size={16} color="var(--hot)" />} tint="var(--hot-soft)" value={temp(cur?.t_hot)} unit="°C" foot={`${t('devices.kpi.setpoint')} ${set(cur?.t_hot_set)}`} />
        <Kpi label={t('devices.kpi.water')} icon={<IconDroplet size={16} />} tint="var(--elev-3)" value={cur?.water_total_l == null ? '—' : String(Math.round(cur.water_total_l))} unit="L" foot={t('devices.kpi.waterFoot')} />
        <Kpi label={t('devices.kpi.filter')} icon={<IconFilter size={16} color="var(--ok)" />} tint="var(--ok-soft)" value={d.filter ? String(Math.round(d.filter.left_pct)) : '—'} unit="%"
          foot={d.filter?.forecast_at ? `≈ ${new Date(d.filter.forecast_at).toLocaleDateString()}` : t('devices.kpi.noData')} bar={d.filter?.left_pct} />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <div className="ic-card" style={{ padding: 22 }}>
          <Title order={4} className="ic-card-title" mb="md">{t('devices.identity')}</Title>
          <Facts rows={[
            [t('devices.serial'), <span key="s" className="ic-mono" style={{ color: 'var(--text)' }}>{d.serial}</span>],
            [t('devices.deviceId'), <span key="id" className="ic-mono" style={{ color: 'var(--text)' }}>{d.device_id}</span>],
            [t('devices.imei'), d.imei], [t('devices.model'), modelLabel(d.model)], [t('devices.hw'), d.hw], [t('devices.fw'), d.fw],
            [t('devices.lifecycle'), tx(en.devices.lifecycles, d.lifecycle)], [t('devices.description'), d.description], [t('common.created'), fmt(d.created_at)],
          ]} />
        </div>
        <div className="ic-card" style={{ padding: 22 }}>
          <Title order={4} className="ic-card-title" mb="md">{t('devices.placement')}</Title>
          <Facts rows={[
            [t('devices.client'), d.client ? <Anchor key="c" component={Link} to={`/clients/${d.client.id}`}>{d.client.name}</Anchor> : t('devices.stock')],
            [t('devices.address'), a?.address], [t('clients.region'), a?.region], [t('clients.floor'), a?.floor], [t('clients.place'), a?.place],
            [t('clients.accessNote'), a?.access_note], [t('devices.ownership'), tx(en.devices.ownerships, d.ownership)],
          ]} />
        </div>
        <div className="ic-card" style={{ padding: 22 }}>
          <Title order={4} className="ic-card-title" mb="md">{t('devices.connectivity')}</Title>
          <Facts rows={[
            [t('common.status'), d.online ? t('devices.online') : t('devices.offline')], [t('devices.lastSeen'), fmt(d.last_seen_at)],
            [t('devices.signal'), cur?.rsrp != null ? `${cur.rsrp} dBm` : null], [t('devices.carrier'), cur?.operator], [t('devices.alerts'), String(d.alerts_open ?? 0)],
          ]} />
        </div>
      </SimpleGrid>
      {can(role, 'getDeviceHistory') && <History id={id} card={d} />}
      {modal === 'edit' && <DeviceModal device={d} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'transfer' && <TransferModal d={d} onClose={() => setModal(null)} onDone={refresh} />}
      {(modal === 'lifecycle' || modal === 'ownership') && <StatusModal kind={modal} d={d} onClose={() => setModal(null)} onDone={refresh} />}
    </Stack>
  );
}

/** Плитка показателя, как в демо: подпись со значком, крупное значение, подпись снизу (и полоска для ресурса фильтра). */
function Kpi({ label, icon, tint, value, unit, foot, bar }: { label: string; icon: React.ReactNode; tint: string; value: string; unit: string; foot: string; bar?: number | undefined }) {
  return (
    <div className="ic-card ic-kpi">
      <div className="ic-kpi-label">{label}<span className="ic-kpi-icon" style={{ background: tint }}>{icon}</span></div>
      <div className="ic-kpi-value">{value}{value !== '—' && <small>{unit}</small>}</div>
      <div className="ic-kpi-foot">{foot}</div>
      {bar != null && <div style={{ height: 4, borderRadius: 4, background: 'var(--elev-3)', marginTop: 8 }}><div style={{ width: `${Math.max(0, Math.min(100, bar))}%`, height: 4, borderRadius: 4, background: 'var(--ok)' }} /></div>}
    </div>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="ic-facts" style={{ margin: 0 }}>
      {rows.map(([k, v]) => [<dt key={`${k}-k`}>{k}</dt>, <dd key={`${k}-v`}>{v ?? '—'}</dd>])}
    </dl>
  );
}

function TransferModal({ d, onClose, onDone }: { d: Card; onClose: () => void; onDone: () => unknown }) {
  const clients = useClientOptions();
  const form = useForm({ initialValues: { client_id: d.client_id ?? '', address_id: d.address_id ?? '', comment: '' } });
  const clientId = form.values.client_id;
  const client = useQuery({
    queryKey: ['client', clientId], enabled: !!clientId,
    queryFn: () => ok(api.GET('/clients/{clientId}', { params: { path: { clientId } } })),
  });
  const addresses = (client.data?.addresses ?? []).map((a) => ({ value: a.id, label: [a.address, a.floor && `${t('clients.floor')} ${a.floor}`, a.place].filter(Boolean).join(', ') }));
  return (
    <Modal opened onClose={onClose} title={t('devices.transferTitle')} centered>
      <form onSubmit={form.onSubmit(async (v) => {
        try {
          await ok(api.POST('/devices/{deviceId}/transfer', { params: { path: { deviceId: d.id } }, body: {
            client_id: v.client_id || null, address_id: v.client_id && v.address_id ? v.address_id : null, comment: orNull(v.comment),
          } }));
          notifyOk(); onClose(); void onDone();
        } catch (e) { applyErrors(form, e); }
      })}>
        <Stack>
          {clients.isError && <LoadError error={clients.error} retry={() => clients.refetch()} />}
          <Select label={t('devices.client')} data={[{ value: '', label: t('devices.stock') }, ...(clients.data ?? [])]} searchable allowDeselect={false}
            {...form.getInputProps('client_id')} onChange={(v) => { form.setFieldValue('client_id', v ?? ''); form.setFieldValue('address_id', ''); }} />
          {client.isError && <Alert color="red" title={t('devices.addressesError')}>
            <Button size="xs" variant="light" color="red" onClick={() => void client.refetch()}>{t('common.retry')}</Button>
          </Alert>}
          <Select label={t('devices.address')} data={addresses} disabled={!clientId || !client.isSuccess} clearable {...form.getInputProps('address_id')}
            placeholder={clientId && client.isPending ? t('common.loading') : undefined} onChange={(v) => form.setFieldValue('address_id', v ?? '')} />
          <Textarea label={t('clients.comment')} autosize {...form.getInputProps('comment')} />
          <Group justify="flex-end"><Button type="submit" loading={form.submitting} disabled={!!clientId && !client.isSuccess}>{t('devices.transfer')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}

function StatusModal({ kind, d, onClose, onDone }: { kind: 'lifecycle' | 'ownership'; d: Card; onClose: () => void; onDone: () => unknown }) {
  const form = useForm({ initialValues: { value: kind === 'lifecycle' ? d.lifecycle : d.ownership, comment: '' } });
  return (
    <Modal opened onClose={onClose} title={kind === 'lifecycle' ? t('devices.changeLifecycle') : t('devices.changeOwnership')} centered>
      <form onSubmit={form.onSubmit(async (v) => {
        try {
          const comment = orNull(v.comment);
          if (kind === 'lifecycle') await ok(api.PUT('/devices/{deviceId}/lifecycle', { params: { path: { deviceId: d.id } }, body: { lifecycle: v.value as Lifecycle, comment } }));
          else await ok(api.PUT('/devices/{deviceId}/ownership', { params: { path: { deviceId: d.id } }, body: { ownership: v.value as Ownership, comment } }));
          notifyOk(); onClose(); void onDone();
        } catch (e) { applyErrors(form, e, { lifecycle: 'value', ownership: 'value' }); }
      })}>
        <Stack>
          <Select label={kind === 'lifecycle' ? t('devices.lifecycle') : t('devices.ownership')} data={kind === 'lifecycle' ? LIFECYCLE_OPTS : OWNERSHIP_OPTS}
            allowDeselect={false} {...form.getInputProps('value')} />
          <Textarea label={t('clients.comment')} autosize {...form.getInputProps('comment')} />
          <Group justify="flex-end"><Button type="submit" loading={form.submitting}>{t('common.save')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** История клиента, адреса, жизненного цикла и аренды (V-013, V-014). Клиенты — по имени, адреса текущего клиента — текстом. */
function History({ id, card }: { id: string; card: Card }) {
  const clients = useClientOptions();
  const list = useInfiniteQuery({
    queryKey: ['device-history', id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => ok(api.GET('/devices/{deviceId}/history', { params: { path: { deviceId: id }, query: pageParam ? { cursor: pageParam } : {} } })),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  });
  const names = new Map((clients.data ?? []).map((c) => [c.value, c.label]));
  const here = card.address_detail ? new Map([[card.address_detail.id, card.address_detail.address]]) : new Map<string, string>();
  const show = (field: string, v: unknown): string => {
    if (v == null) return field === 'client' ? t('devices.stock') : '—';
    const s = String(v);
    if (field === 'client') return names.get(s) ?? `${s.slice(0, 8)}…`;
    if (field === 'address') return here.get(s) ?? `${s.slice(0, 8)}…`;
    if (field === 'lifecycle') return tx(en.devices.lifecycles, s);
    if (field === 'ownership') return tx(en.devices.ownerships, s);
    return s;
  };
  const items = list.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <div className="ic-card" style={{ padding: 22 }}>
      <Title order={4} className="ic-card-title" mb="xs">{t('devices.history')}</Title>
      {list.isError && <LoadError error={list.error} retry={() => list.refetch()} />}
      {list.isSuccess && !items.length ? <Text c="dimmed">{t('devices.historyEmpty')}</Text> : (
        <Table.ScrollContainer minWidth={640}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('devices.at')}</Table.Th><Table.Th>{t('devices.field')}</Table.Th><Table.Th>{t('devices.before')}</Table.Th>
                <Table.Th>{t('devices.after')}</Table.Th><Table.Th>{t('clients.comment')}</Table.Th><Table.Th>{t('devices.by')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((h, i) => (
                <Table.Tr key={`${h.at}-${h.field}-${i}`}>
                  <Table.Td>{fmt(h.at)}</Table.Td><Table.Td>{tx(en.devices.fields, h.field)}</Table.Td>
                  <Table.Td>{show(h.field, h.before)}</Table.Td><Table.Td>{show(h.field, h.after)}</Table.Td>
                  <Table.Td>{h.comment ?? ''}</Table.Td><Table.Td>{h.by ? `${h.by.slice(0, 8)}…` : '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {list.hasNextPage && <Group mt="xs"><Button variant="default" size="xs" onClick={() => void list.fetchNextPage()}>{t('common.loadMore')}</Button></Group>}
    </div>
  );
}
