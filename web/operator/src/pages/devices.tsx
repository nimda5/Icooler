// Реестр устройств (§4.2): список с поиском, фильтрами и сортировкой, создание (V-010), карточка устройства —
// идентификаторы и модель, клиент и адрес, перенос (V-014), жизненный цикл и аренда/покупка (V-013, P-09), история.
// Состояние (online, тех. состояние, прошивка, фильтр, алерты) приходит от устройства — до первой связи его нет.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Alert, Anchor, Badge, Button, Card, Checkbox, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconArrowsSort } from '@tabler/icons-react';
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
const STATE_COLOR: Record<string, string> = { operational: 'teal', warning: 'yellow', fault: 'red', offline: 'gray' };
const BADGE = { root: { overflow: 'visible', flexShrink: 0 }, label: { overflow: 'visible', textOverflow: 'clip' } } as const;

/** '' → null: пустое необязательное поле формы уходит в API как «нет значения». */
export const orNull = (v: string): string | null => (v.trim() ? v.trim() : null);

export function StateBadge({ d }: { d: Pick<Device, 'state' | 'last_seen_at'> }) {
  const never = d.state === 'offline' && !d.last_seen_at;
  return (
    <Badge color={STATE_COLOR[d.state]} variant="light" styles={BADGE} title={never ? t('devices.neverSeen') : undefined}>
      {tx(en.devices.states, d.state)}
    </Badge>
  );
}

export const modelLabel = (m: Model): string =>
  [tx(en.devices.waterSources, m.water_source), m.variant, m.carbonated ? 'CO₂' : null, m.sku].filter(Boolean).join(' · ');

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} %`);
const placeOf = (d: Pick<ListItem, 'address' | 'floor' | 'place'>) =>
  [d.address, d.floor ? `${t('clients.floor')} ${d.floor}` : null, d.place].filter(Boolean).join(', ') || '—';

/** Таблица устройств: реестр и карточка клиента (V-024). */
export function DeviceTable({ items, showClient = true }: { items: ListItem[]; showClient?: boolean }) {
  return (
    <Table.ScrollContainer minWidth={900}>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('devices.serial')}</Table.Th><Table.Th>{t('devices.deviceId')}</Table.Th><Table.Th>{t('devices.model')}</Table.Th>
            {showClient && <Table.Th>{t('devices.client')}</Table.Th>}
            <Table.Th>{t('devices.address')}</Table.Th><Table.Th>{t('devices.lifecycle')}</Table.Th><Table.Th>{t('devices.state')}</Table.Th>
            <Table.Th>{t('devices.lastSeen')}</Table.Th><Table.Th>{t('devices.filter')}</Table.Th><Table.Th>{t('devices.liters')}</Table.Th><Table.Th>{t('devices.alerts')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((d) => (
            <Table.Tr key={d.id}>
              <Table.Td><Anchor component={Link} to={`/devices/${d.id}`}>{d.serial}</Anchor></Table.Td>
              <Table.Td><Text size="sm" ff="monospace" style={{ whiteSpace: 'nowrap' }}>{d.device_id}</Text></Table.Td>
              <Table.Td>{modelLabel(d.model)}</Table.Td>
              {showClient && <Table.Td>{d.client_id ? <Anchor component={Link} to={`/clients/${d.client_id}`}>{d.client_name}</Anchor> : '—'}</Table.Td>}
              <Table.Td>{placeOf(d)}</Table.Td>
              <Table.Td>{tx(en.devices.lifecycles, d.lifecycle)}</Table.Td>
              <Table.Td style={{ whiteSpace: 'nowrap' }}><StateBadge d={d} /></Table.Td>
              <Table.Td>{fmt(d.last_seen_at)}</Table.Td>
              <Table.Td>{pct(d.filter_left_pct)}</Table.Td>
              <Table.Td>{d.liters_period == null ? '—' : `${Math.round(d.liters_period)} l`}</Table.Td>
              <Table.Td>{d.alerts_open ? <Badge color="red" variant="light" styles={BADGE}>{d.alerts_open}</Badge> : '0'}</Table.Td>
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
  return (
    <Stack>
      <PageTitle right={can(role, 'createDevice') && <Button onClick={() => setCreating(true)}>{t('devices.create')}</Button>}>{t('devices.title')}</PageTitle>
      <Group align="flex-end">
        <TextInput placeholder={t('common.search')} aria-label={t('common.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <Select placeholder={t('devices.client')} aria-label={t('devices.client')} data={clients.data ?? []} value={f['client_id'] ?? null} onChange={set('client_id')} searchable clearable />
        <Select placeholder={t('devices.lifecycle')} aria-label={t('devices.lifecycle')} data={LIFECYCLE_OPTS} value={f['lifecycle'] ?? null} onChange={set('lifecycle')} clearable />
        <Select placeholder={t('devices.state')} aria-label={t('devices.state')} data={STATE_OPTS} value={f['state'] ?? null} onChange={set('state')} clearable />
        <Select placeholder={t('devices.ownership')} aria-label={t('devices.ownership')} data={OWNERSHIP_OPTS} value={f['ownership'] ?? null} onChange={set('ownership')} clearable />
        <Select placeholder={t('devices.waterSource')} aria-label={t('devices.waterSource')} data={WATER_OPTS} value={f['model'] ?? null} onChange={set('model')} clearable />
        <Select placeholder={t('devices.alertType')} aria-label={t('devices.alertType')} data={ALERT_OPTS} value={f['alert_type'] ?? null} onChange={set('alert_type')} clearable />
        <NumberInput placeholder={t('devices.filterMax')} aria-label={t('devices.filterMax')} min={0} max={100} w={150} value={f['filter_left_max_pct'] ?? ''}
          onChange={(v) => set('filter_left_max_pct')(v === '' ? null : String(v))} />
        <TextInput placeholder={t('clients.region')} aria-label={t('clients.region')} value={f['region'] ?? ''} onChange={(e) => set('region')(e.currentTarget.value.trim() || null)} />
        <Select aria-label={t('devices.sort')} leftSection={<IconArrowsSort size={16} />} data={SORT_OPTS} value={f['sort'] ?? '-created_at'} onChange={set('sort')} allowDeselect={false} />
      </Group>
      <DeviceTable items={items} />
      {list.isSuccess && !items.length && <Text c="dimmed">{t('devices.empty')}</Text>}
      {list.isError && !list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.refetch()} />}
      {list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.fetchNextPage()} />}
      {list.isPending && <Text c="dimmed">{t('common.loading')}</Text>}
      {list.hasNextPage && <Group><Button variant="default" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t('common.loadMore')}</Button></Group>}
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
  return (
    <Stack>
      <PageTitle right={
        <Group gap="xs">
          {editable && <Button variant="default" onClick={() => setModal('edit')}>{t('common.edit')}</Button>}
          {can(role, 'transferDevice') && <Button variant="default" onClick={() => setModal('transfer')}>{t('devices.transfer')}</Button>}
          {can(role, 'setLifecycle') && <Button variant="default" onClick={() => setModal('lifecycle')}>{t('devices.changeLifecycle')}</Button>}
          {can(role, 'setOwnership') && <Button variant="default" onClick={() => setModal('ownership')}>{t('devices.changeOwnership')}</Button>}
        </Group>
      }>
        {d.serial} <StateBadge d={d} />
      </PageTitle>
      {!d.last_seen_at && <Alert color="gray">{t('devices.neverSeen')}. {t('devices.liveNote')}</Alert>}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Title order={4} mb="xs">{t('devices.identity')}</Title>
          <Facts rows={[
            [t('devices.deviceId'), <Text key="id" ff="monospace" size="sm">{d.device_id}</Text>], [t('devices.serial'), d.serial], [t('devices.imei'), d.imei],
            [t('devices.model'), modelLabel(d.model)], [t('devices.hw'), d.hw], [t('devices.fw'), d.fw], [t('devices.description'), d.description],
            [t('common.created'), fmt(d.created_at)],
          ]} />
        </Card>
        <Card withBorder>
          <Title order={4} mb="xs">{t('devices.placement')}</Title>
          <Facts rows={[
            [t('devices.client'), d.client ? <Anchor key="c" component={Link} to={`/clients/${d.client.id}`}>{d.client.name}</Anchor> : t('devices.stock')],
            [t('devices.address'), d.address_detail?.address], [t('clients.region'), d.address_detail?.region],
            [t('clients.floor'), d.address_detail?.floor], [t('clients.place'), d.address_detail?.place],
            [t('devices.lifecycle'), tx(en.devices.lifecycles, d.lifecycle)], [t('devices.ownership'), tx(en.devices.ownerships, d.ownership)],
            [t('devices.lastSeen'), fmt(d.last_seen_at)], [t('devices.filter'), pct(d.filter?.left_pct)], [t('devices.alerts'), String(d.alerts_open ?? 0)],
            ...(d.blocked ? [[t('common.status'), t('devices.blocked')] as [string, string]] : []),
          ]} />
        </Card>
      </SimpleGrid>
      {can(role, 'getDeviceHistory') && <History id={id} card={d} />}
      {modal === 'edit' && <DeviceModal device={d} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'transfer' && <TransferModal d={d} onClose={() => setModal(null)} onDone={refresh} />}
      {(modal === 'lifecycle' || modal === 'ownership') && <StatusModal kind={modal} d={d} onClose={() => setModal(null)} onDone={refresh} />}
    </Stack>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <Table withRowBorders={false} verticalSpacing={4}>
      <Table.Tbody>
        {rows.map(([k, v]) => (
          <Table.Tr key={k}><Table.Td c="dimmed" w="40%">{k}</Table.Td><Table.Td>{v ?? '—'}</Table.Td></Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
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
    <Card withBorder>
      <Title order={4} mb="xs">{t('devices.history')}</Title>
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
    </Card>
  );
}
