// Учётные записи End User (§7.5, Admin и Dispatcher): приглашение к клиенту, клиенты, блокировка, удаление.
import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ok, ApiError, type Schemas } from '../api/client';
import { en, t, tx } from '../i18n';
import { act, applyErrors, ConfirmButton, fmt, LoadError, notifyOk, PageTitle } from './common';
import { STATUS_COLOR } from './users';

type EndUser = Schemas['EndUser'];
const LANGS = Object.entries(en.languages).map(([value, label]) => ({ value, label }));

/** Клиенты для выбора. Пока нет API клиентов (4.3) — пустой список и подсказка. */
function useClients() {
  return useQuery({
    queryKey: ['clients', 'options'],
    queryFn: async () => {
      try {
        const all: { value: string; label: string }[] = [];
        let cursor: string | undefined;
        do {
          const r = await ok(api.GET('/clients', { params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } } }));
          all.push(...(r.items ?? []).map((c) => ({ value: c.id, label: c.name })));
          cursor = r.next_cursor ?? undefined;
        } while (cursor);
        return all;
      } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    },
  });
}

export function EndUsersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(false);
  const [clientsOf, setClientsOf] = useState<EndUser | null>(null);
  const [editing, setEditing] = useState<EndUser | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['end-users', q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => ok(api.GET('/end-users', { params: { query: { ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['end-users'] });
  const items = list.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <Stack>
      <PageTitle right={<Button onClick={() => setInviting(true)}>{t('endUsers.invite')}</Button>}>{t('endUsers.title')}</PageTitle>
      <Group><TextInput placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label={t('common.search')} /></Group>
      <Table.ScrollContainer minWidth={720}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('common.name')}</Table.Th><Table.Th>{t('common.email')}</Table.Th><Table.Th>{t('endUsers.clients')}</Table.Th>
              <Table.Th>{t('common.status')}</Table.Th><Table.Th>{t('common.lastLogin')}</Table.Th><Table.Th>{t('common.actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.name}</Table.Td>
                <Table.Td>{u.email}</Table.Td>
                <Table.Td>{u.clients.map((c) => c.name).join(', ')}</Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}><Badge color={STATUS_COLOR[u.status]} variant="light" styles={{ root: { overflow: 'visible', flexShrink: 0 }, label: { overflow: 'visible', textOverflow: 'clip' } }}>{tx(en.statuses, u.status)}</Badge></Table.Td>
                <Table.Td>{fmt(u.last_login_at)}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Button size="xs" variant="default" onClick={() => setEditing(u)}>{t('common.edit')}</Button>
                    <Button size="xs" variant="default" onClick={() => setClientsOf(u)}>{t('endUsers.clients')}</Button>
                    {u.status === 'blocked'
                      ? <Button size="xs" variant="light" onClick={act(async () => {
                          await ok(api.DELETE('/end-users/{userId}/block', { params: { path: { userId: u.id } } })); void refresh();
                        })}>{t('common.unblock')}</Button>
                      : <ConfirmButton size="xs" variant="light" color="orange" question={t('users.confirmBlock')}
                          onConfirm={async () => { await ok(api.POST('/end-users/{userId}/block', { params: { path: { userId: u.id } } })); void refresh(); }}>
                          {t('common.block')}
                        </ConfirmButton>}
                    <ConfirmButton size="xs" variant="subtle" question={t('users.confirmDelete')}
                      onConfirm={async () => { await ok(api.DELETE('/end-users/{userId}', { params: { path: { userId: u.id } } })); void refresh(); }}>
                      {t('common.delete')}
                    </ConfirmButton>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {list.isError && !list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.refetch()} />}
      {list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.fetchNextPage()} />}
      {list.isPending && <Text c="dimmed">{t('common.loading')}</Text>}
      {list.hasNextPage && <Group><Button variant="default" onClick={() => void list.fetchNextPage()}>{t('common.loadMore')}</Button></Group>}
      <InviteModal opened={inviting} onClose={() => setInviting(false)} onDone={refresh} />
      {clientsOf && <ClientsModal user={clientsOf} onClose={() => setClientsOf(null)} onDone={refresh} />}
      {editing && <EditModal user={editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </Stack>
  );
}

function InviteModal({ opened, onClose, onDone }: { opened: boolean; onClose: () => void; onDone: () => unknown }) {
  const clients = useClients();
  const form = useForm({ initialValues: { email: '', name: '', client_id: '', language: 'en' } });
  return (
    <Modal opened={opened} onClose={onClose} title={t('endUsers.invite')} centered>
      <form onSubmit={form.onSubmit(async (v) => {
        try {
          await ok(api.POST('/end-users', { body: { email: v.email.trim(), name: v.name.trim(), client_id: v.client_id, language: v.language as 'en' } }));
          notifyOk(t('users.invited')); form.reset(); onClose(); void onDone();
        } catch (e) { applyErrors(form, e); }
      })}>
        <Stack>
          {clients.isError && <LoadError error={clients.error} retry={() => clients.refetch()} />}
          {clients.data === null && <Alert color="gray">{t('endUsers.noClients')}</Alert>}
          <TextInput label={t('common.email')} type="email" required {...form.getInputProps('email')} />
          <TextInput label={t('common.name')} required {...form.getInputProps('name')} />
          <Select label={t('endUsers.client')} data={clients.data ?? []} searchable required disabled={!clients.data} {...form.getInputProps('client_id')} />
          <Select label={t('common.language')} data={LANGS} allowDeselect={false} {...form.getInputProps('language')} />
          <Group justify="flex-end"><Button type="submit" loading={form.submitting} disabled={!clients.data}>{t('endUsers.invite')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}

function ClientsModal({ user, onClose, onDone }: { user: EndUser; onClose: () => void; onDone: () => unknown }) {
  const clients = useClients();
  const [add, setAdd] = useState<string | null>(null);
  const bound = new Set(user.clients.map((c) => c.client_id));
  return (
    <Modal opened onClose={onClose} title={`${t('endUsers.clients')}: ${user.email}`} centered size="lg">
      <Stack>
        <Table>
          <Table.Tbody>
            {user.clients.map((c) => (
              <Table.Tr key={c.client_id}>
                <Table.Td>{c.name}</Table.Td><Table.Td>{fmt(c.bound_at)}</Table.Td>
                <Table.Td>
                  <ConfirmButton size="xs" variant="subtle" question={t('endUsers.confirmUnbind')} onConfirm={async () => {
                    await ok(api.DELETE('/end-users/{userId}/clients/{clientId}', { params: { path: { userId: user.id, clientId: c.client_id } } }));
                    void onDone(); onClose();
                  }}>{t('endUsers.unbind')}</ConfirmButton>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {clients.isError && <LoadError error={clients.error} retry={() => clients.refetch()} />}
        {clients.data === null ? <Alert color="gray">{t('endUsers.noClients')}</Alert> : clients.isError ? null : (
          <Group align="flex-end">
            <Select label={t('endUsers.bind')} data={(clients.data ?? []).filter((c) => !bound.has(c.value))} value={add} onChange={setAdd} searchable style={{ flex: 1 }} />
            <Button disabled={!add} onClick={act(async () => {
              await ok(api.PUT('/end-users/{userId}/clients/{clientId}', { params: { path: { userId: user.id, clientId: add! } } }));
              notifyOk(); void onDone(); onClose();
            })}>{t('endUsers.bind')}</Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}

function EditModal({ user, onClose, onDone }: { user: EndUser; onClose: () => void; onDone: () => unknown }) {
  const form = useForm({ initialValues: { name: user.name, language: user.language } });
  return (
    <Modal opened onClose={onClose} title={`${t('common.edit')}: ${user.email}`} centered>
      <form onSubmit={form.onSubmit(async (v) => {
        try {
          await ok(api.PATCH('/end-users/{userId}', { params: { path: { userId: user.id } }, body: { name: v.name.trim(), language: v.language } }));
          notifyOk(); onClose(); void onDone();
        } catch (e) { applyErrors(form, e); }
      })}>
        <Stack>
          <TextInput label={t('common.name')} required {...form.getInputProps('name')} />
          <Select label={t('common.language')} data={LANGS} allowDeselect={false} {...form.getInputProps('language')} />
          <Group justify="flex-end"><Button type="submit" loading={form.submitting}>{t('common.save')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}
