// Клиенты (§4.3): список с поиском и регионом, создание (V-021); карточка клиента — реквизиты, адреса установки
// с этажом и местом (V-022, P-05), контактные лица (V-023) и все его кулеры (V-024).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Anchor, Badge, Button, Card, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, ok, type Schemas } from '../api/client';
import { useSession } from '../auth/session';
import { can } from '../api/roles';
import { en, t, tx } from '../i18n';
import { applyErrors, ConfirmButton, LoadError, notifyOk, PageTitle } from './common';
import { NotFound } from './misc';
import { DeviceTable, orNull } from './devices';

type Client = Schemas['Client'];
type Address = Schemas['Address'];
type Contact = Schemas['Contact'];
const TYPE_OPTS = Object.entries(en.clients.types).map(([value, label]) => ({ value, label }));

export function ClientsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { role } = useSession();
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [creating, setCreating] = useState(false);
  const query = { ...(q.trim() ? { q: q.trim() } : {}), ...(region.trim() ? { region: region.trim() } : {}) };
  const list = useInfiniteQuery({
    queryKey: ['clients', 'list', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => ok(api.GET('/clients', { params: { query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <Stack gap={0}>
      <PageTitle sub={list.isSuccess ? `${items.length}${list.hasNextPage ? '+' : ''} ${t('clients.shown')}` : ' '}
        right={can(role, 'createClient') && <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>{t('clients.create')}</Button>}>{t('clients.title')}</PageTitle>
      <div className="ic-card">
      <Group p="md" gap="sm">
        <TextInput placeholder={t('clients.searchHint')} aria-label={t('common.search')} leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} style={{ flex: '1 1 280px' }} />
        <TextInput placeholder={t('devices.allRegions')} aria-label={t('clients.region')} value={region} onChange={(e) => setRegion(e.currentTarget.value)} w={180} />
      </Group>
      <Table.ScrollContainer minWidth={640}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('clients.client')}</Table.Th><Table.Th>{t('clients.regNumber')}</Table.Th><Table.Th>{t('clients.legalAddress')}</Table.Th>
              <Table.Th>{t('clients.devices')}</Table.Th><Table.Th>{t('clients.alerts')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((c) => (
              <Table.Tr key={c.id} data-href={`/clients/${c.id}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) void navigate(`/clients/${c.id}`); }}>
                <Table.Td>
                  <Anchor component={Link} to={`/clients/${c.id}`} className="ic-primary" c="inherit" underline="never">{c.name}</Anchor>
                  <div className="ic-secondary">{tx(en.clients.types, c.type)}</div>
                </Table.Td>
                <Table.Td><span className="ic-mono" style={{ color: 'var(--text)' }}>{c.reg_number ?? '—'}</span></Table.Td>
                <Table.Td className="ic-secondary">{c.legal_address ?? '—'}</Table.Td>
                <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{c.devices_total ?? 0}</Table.Td>
                <Table.Td>{c.alerts_open ? <span className="ic-badge crit plain">{c.alerts_open}</span> : <span className="ic-secondary">0</span>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Stack p={items.length ? 0 : 'md'} gap="sm">
      {list.isSuccess && !items.length && <Text c="dimmed">{t('clients.empty')}</Text>}
      {list.isError && !list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.refetch()} />}
      {list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.fetchNextPage()} />}
      {list.isPending && <Text c="dimmed">{t('common.loading')}</Text>}
      {list.hasNextPage && <Group p="md"><Button variant="default" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t('common.loadMore')}</Button></Group>}
      </Stack>
      </div>
      {creating && <ClientModal onClose={() => setCreating(false)} onDone={() => qc.invalidateQueries({ queryKey: ['clients'] })} />}
    </Stack>
  );
}

function ClientModal({ client, onClose, onDone }: { client?: Client; onClose: () => void; onDone: (c: Client) => unknown }) {
  const navigate = useNavigate();
  const form = useForm({ initialValues: { type: client?.type ?? 'organization', name: client?.name ?? '', reg_number: client?.reg_number ?? '', legal_address: client?.legal_address ?? '' } });
  return (
    <Modal opened onClose={onClose} title={client ? `${t('common.edit')}: ${client.name}` : t('clients.create')} centered>
      <form onSubmit={form.onSubmit(async (v) => {
        const body = { type: v.type as Client['type'], name: v.name.trim(), reg_number: orNull(v.reg_number), legal_address: orNull(v.legal_address) };
        try {
          const c = client
            ? await ok(api.PATCH('/clients/{clientId}', { params: { path: { clientId: client.id } }, body }))
            : await ok(api.POST('/clients', { body }));
          notifyOk(); onClose(); void onDone(c);
          if (!client) void navigate(`/clients/${c.id}`);
        } catch (e) { applyErrors(form, e); }
      })}>
        <Stack>
          <Select label={t('clients.type')} data={TYPE_OPTS} allowDeselect={false} {...form.getInputProps('type')} />
          <TextInput label={t('common.name')} required {...form.getInputProps('name')} />
          <TextInput label={t('clients.regNumber')} {...form.getInputProps('reg_number')} />
          <Textarea label={t('clients.legalAddress')} autosize {...form.getInputProps('legal_address')} />
          <Group justify="flex-end"><Button type="submit" loading={form.submitting}>{client ? t('common.save') : t('clients.create')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ClientPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { role } = useSession();
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState<Address | 'new' | null>(null);
  const [contact, setContact] = useState<Contact | 'new' | null>(null);
  const card = useQuery({
    queryKey: ['client', id], enabled: UUID.test(id),
    queryFn: () => ok(api.GET('/clients/{clientId}', { params: { path: { clientId: id } } })),
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['client', id] }), qc.invalidateQueries({ queryKey: ['clients'] })]);
  if (!UUID.test(id) || (card.error instanceof ApiError && card.error.status === 404)) return <NotFound />;
  if (card.isError) return <LoadError error={card.error} retry={() => card.refetch()} />;
  if (!card.data) return <Text c="dimmed">{t('common.loading')}</Text>;
  const c = card.data;
  const canEdit = can(role, 'updateClient');
  return (
    <Stack>
      <PageTitle right={
        <Group gap="xs">
          {canEdit && <Button variant="default" onClick={() => setEditing(true)}>{t('common.edit')}</Button>}
          {can(role, 'deleteClient') && (
            <ConfirmButton variant="subtle" question={t('clients.confirmDelete')} onConfirm={async () => {
              await ok(api.DELETE('/clients/{clientId}', { params: { path: { clientId: c.id } } }));
              await qc.invalidateQueries({ queryKey: ['clients'] }); void navigate('/clients');
            }}>{t('common.delete')}</ConfirmButton>
          )}
        </Group>
      } back={<Group gap={6} mb={8}><Anchor component={Link} to="/clients" c="dimmed" size="sm">‹ {t('clients.title')}</Anchor></Group>}
        eyebrow={tx(en.clients.types, c.type)} sub={[c.reg_number, c.legal_address].filter(Boolean).join(' · ') || ' '}>{c.name}</PageTitle>
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card padding={22}>
          <Group justify="space-between" mb="xs">
            <Title order={4} className="ic-card-title">{t('clients.addresses')}</Title>
            {can(role, 'createAddress') && <Button size="xs" variant="light" onClick={() => setAddress('new')}>{t('clients.addAddress')}</Button>}
          </Group>
          <Table.ScrollContainer minWidth={480}>
            <Table>
              <Table.Tbody>
                {c.addresses.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td>
                      <Text size="sm">{a.address}</Text>
                      <Text size="xs" c="dimmed">{[a.region, a.floor && `${t('clients.floor')} ${a.floor}`, a.place].filter(Boolean).join(' · ')}</Text>
                      {a.access_note && <Text size="xs">{t('clients.accessNote')}: {a.access_note}</Text>}
                      <Text size="xs" c="dimmed">
                        {a.lat != null && a.lng != null
                          ? `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}${a.coords_source ? ` (${tx(en.clients.coordsSource, a.coords_source)})` : ''}`
                          : `${t('clients.coords')}: ${t('clients.noCoords')}`}
                      </Text>
                    </Table.Td>
                    <Table.Td w={1}>
                      <Group gap={4} wrap="nowrap">
                        {can(role, 'updateAddress') && <Button size="xs" variant="default" onClick={() => setAddress(a)}>{t('common.edit')}</Button>}
                        {can(role, 'deleteAddress') && (
                          <ConfirmButton size="xs" variant="subtle" question={t('clients.confirmDeleteAddress')} onConfirm={async () => {
                            await ok(api.DELETE('/addresses/{addressId}', { params: { path: { addressId: a.id } } })); void refresh();
                          }}>{t('common.delete')}</ConfirmButton>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
        <Card padding={22}>
          <Group justify="space-between" mb="xs">
            <Title order={4} className="ic-card-title">{t('clients.contacts')}</Title>
            {can(role, 'createContact') && <Button size="xs" variant="light" onClick={() => setContact('new')}>{t('clients.addContact')}</Button>}
          </Group>
          <Table.ScrollContainer minWidth={480}>
            <Table>
              <Table.Tbody>
                {c.contacts.map((k) => (
                  <Table.Tr key={k.id}>
                    <Table.Td>
                      <Text size="sm">{k.name}{k.role ? <Text span c="dimmed" size="sm"> · {k.role}</Text> : null}</Text>
                      <Text size="xs" c="dimmed">{[k.phone, k.email].filter(Boolean).join(' · ')}</Text>
                      {k.comment && <Text size="xs" c="dimmed">{k.comment}</Text>}
                    </Table.Td>
                    <Table.Td w={1}>
                      <Group gap={4} wrap="nowrap">
                        {can(role, 'updateContact') && <Button size="xs" variant="default" onClick={() => setContact(k)}>{t('common.edit')}</Button>}
                        {can(role, 'deleteContact') && (
                          <ConfirmButton size="xs" variant="subtle" question={t('clients.confirmDeleteContact')} onConfirm={async () => {
                            await ok(api.DELETE('/contacts/{contactId}', { params: { path: { contactId: k.id } } })); void refresh();
                          }}>{t('common.delete')}</ConfirmButton>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      </SimpleGrid>
      <Card padding={22}>
        <Title order={4} className="ic-card-title" mb="xs">{t('clients.devices')}</Title>
        {c.devices.length ? <DeviceTable items={c.devices} showClient={false} /> : <Text c="dimmed">{t('devices.empty')}</Text>}
      </Card>
      {editing && <ClientModal client={c} onClose={() => setEditing(false)} onDone={refresh} />}
      {address && <AddressModal clientId={c.id} address={address === 'new' ? undefined : address} onClose={() => setAddress(null)} onDone={refresh} />}
      {contact && <ContactModal clientId={c.id} contact={contact === 'new' ? undefined : contact} onClose={() => setContact(null)} onDone={refresh} />}
    </Stack>
  );
}

/** Адрес установки. Координаты пустые — сервер находит их по адресу; заданы — ручная правка. */
function AddressModal({ clientId, address, onClose, onDone }: { clientId: string; address?: Address; onClose: () => void; onDone: () => unknown }) {
  const manual = address?.coords_source === 'manual';
  const form = useForm({
    initialValues: {
      address: address?.address ?? '', region: address?.region ?? '', floor: address?.floor ?? '', place: address?.place ?? '',
      access_note: address?.access_note ?? '', lat: (manual ? address?.lat : null) ?? ('' as number | ''), lng: (manual ? address?.lng : null) ?? ('' as number | ''),
    },
    validate: {
      lat: (v, all) => ((v === '') !== (all.lng === '') ? t('clients.coordsHint') : null),
      lng: (v, all) => ((v === '') !== (all.lat === '') ? t('clients.coordsHint') : null),
    },
  });
  return (
    <Modal opened onClose={onClose} title={address ? `${t('common.edit')}: ${address.address}` : t('clients.addAddress')} centered size="lg">
      <form onSubmit={form.onSubmit(async (v) => {
        const coords = v.lat !== '' && v.lng !== '' ? { lat: Number(v.lat), lng: Number(v.lng), coords_source: 'manual' as const } : { lat: null, lng: null };
        const body = { address: v.address.trim(), region: orNull(v.region), floor: orNull(v.floor), place: orNull(v.place), access_note: orNull(v.access_note), ...coords };
        try {
          if (address) await ok(api.PATCH('/addresses/{addressId}', { params: { path: { addressId: address.id } }, body }));
          else await ok(api.POST('/clients/{clientId}/addresses', { params: { path: { clientId } }, body }));
          notifyOk(); onClose(); void onDone();
        } catch (e) { applyErrors(form, e); }
      })}>
        <Stack>
          <TextInput label={t('clients.address')} required {...form.getInputProps('address')} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label={t('clients.region')} {...form.getInputProps('region')} />
            <TextInput label={t('clients.floor')} {...form.getInputProps('floor')} />
          </SimpleGrid>
          <TextInput label={t('clients.place')} description={t('clients.placeHint')} {...form.getInputProps('place')} />
          <Textarea label={t('clients.accessNote')} autosize {...form.getInputProps('access_note')} />
          <Text size="sm" fw={500}>{t('clients.coords')}</Text>
          <Text size="xs" c="dimmed" mt={-12}>{t('clients.coordsHint')}</Text>
          <SimpleGrid cols={2}>
            <NumberInput label={t('clients.lat')} min={-90} max={90} decimalScale={6} {...form.getInputProps('lat')} />
            <NumberInput label={t('clients.lng')} min={-180} max={180} decimalScale={6} {...form.getInputProps('lng')} />
          </SimpleGrid>
          <Group justify="flex-end"><Button type="submit" loading={form.submitting}>{t('common.save')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}

function ContactModal({ clientId, contact, onClose, onDone }: { clientId: string; contact?: Contact; onClose: () => void; onDone: () => unknown }) {
  const form = useForm({ initialValues: { name: contact?.name ?? '', phone: contact?.phone ?? '', email: contact?.email ?? '', role: contact?.role ?? '', comment: contact?.comment ?? '' } });
  return (
    <Modal opened onClose={onClose} title={contact ? `${t('common.edit')}: ${contact.name}` : t('clients.addContact')} centered>
      <form onSubmit={form.onSubmit(async (v) => {
        const body = { name: v.name.trim(), phone: orNull(v.phone), email: orNull(v.email), role: orNull(v.role), comment: orNull(v.comment) };
        try {
          if (contact) await ok(api.PATCH('/contacts/{contactId}', { params: { path: { contactId: contact.id } }, body }));
          else await ok(api.POST('/clients/{clientId}/contacts', { params: { path: { clientId } }, body }));
          notifyOk(); onClose(); void onDone();
        } catch (e) { applyErrors(form, e); }
      })}>
        <Stack>
          <TextInput label={t('common.name')} required {...form.getInputProps('name')} />
          <TextInput label={t('clients.contactRole')} {...form.getInputProps('role')} />
          <TextInput label={t('clients.phone')} type="tel" {...form.getInputProps('phone')} />
          <TextInput label={t('common.email')} type="email" {...form.getInputProps('email')} />
          <Textarea label={t('clients.comment')} autosize {...form.getInputProps('comment')} />
          <Group justify="flex-end"><Button type="submit" loading={form.submitting}>{t('common.save')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}
