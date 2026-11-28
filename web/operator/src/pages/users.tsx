// Пользователи оператора (V-003, Admin): список с фильтрами, приглашение, роль и язык, блокировка, удаление.
import { useState } from 'react';
import { Badge, Button, Group, Modal, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api, ok, type Schemas } from '../api/client';
import { useSession } from '../auth/session';
import { en, t, tx } from '../i18n';
import { act, applyErrors, ConfirmButton, fmt, LoadError, notifyOk, PageTitle } from './common';

type User = Schemas['User'];
const OPERATOR_ROLES = ['admin', 'tech', 'exec', 'dispatcher'] as const;
const ROLE_OPTS = OPERATOR_ROLES.map((r) => ({ value: r, label: tx(en.roles, r) }));
const STATUS_OPTS = (['invited', 'active', 'blocked'] as const).map((s) => ({ value: s, label: tx(en.statuses, s) }));
const LANGS = Object.entries(en.languages).map(([value, label]) => ({ value, label }));
export const STATUS_COLOR: Record<string, string> = { invited: 'yellow', active: 'teal', blocked: 'red' };

export function UsersPage() {
  const qc = useQueryClient();
  const { profile } = useSession();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const key = ['users', q, role, status];
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => ok(api.GET('/users', { params: { query: {
      ...(q ? { q } : {}), ...(role ? { role: role as 'admin' } : {}), ...(status ? { status: status as 'active' } : {}),
      ...(pageParam ? { cursor: pageParam } : {}),
    } } })),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const users = list.data?.pages.flatMap((p) => p.items ?? []) ?? [];

  return (
    <Stack>
      <PageTitle right={<Button onClick={() => setInviting(true)}>{t('users.invite')}</Button>}>{t('users.title')}</PageTitle>
      <Group>
        <TextInput placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label={t('common.search')} />
        <Select placeholder={t('users.filterRole')} data={ROLE_OPTS} value={role} onChange={setRole} clearable aria-label={t('users.filterRole')} />
        <Select placeholder={t('users.filterStatus')} data={STATUS_OPTS} value={status} onChange={setStatus} clearable aria-label={t('users.filterStatus')} />
      </Group>
      <div className="ic-card" style={{ padding: '4px 6px' }}><Table.ScrollContainer minWidth={720}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('common.name')}</Table.Th><Table.Th>{t('common.email')}</Table.Th><Table.Th>{t('common.role')}</Table.Th>
              <Table.Th>{t('common.status')}</Table.Th><Table.Th>{t('common.lastLogin')}</Table.Th><Table.Th>{t('common.actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((u) => {
              const self = u.id === profile?.id;
              return (
                <Table.Tr key={u.id}>
                  <Table.Td>{u.name} {self && <Badge size="xs" variant="light">{t('users.self')}</Badge>}</Table.Td>
                  <Table.Td>{u.email}</Table.Td>
                  <Table.Td>{tx(en.roles, u.role)}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}><Badge color={STATUS_COLOR[u.status]} variant="light" styles={{ root: { overflow: 'visible', flexShrink: 0 }, label: { overflow: 'visible', textOverflow: 'clip' } }}>{tx(en.statuses, u.status)}</Badge></Table.Td>
                  <Table.Td>{fmt(u.last_login_at)}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button size="xs" variant="default" onClick={() => setEditing(u)}>{t('common.edit')}</Button>
                      {!self && (u.status === 'blocked'
                        ? <Button size="xs" variant="light" onClick={act(async () => {
                            await ok(api.DELETE('/users/{userId}/block', { params: { path: { userId: u.id } } })); notifyOk(); void refresh();
                          })}>{t('common.unblock')}</Button>
                        : <ConfirmButton size="xs" variant="light" color="orange" question={t('users.confirmBlock')}
                            onConfirm={async () => { await ok(api.POST('/users/{userId}/block', { params: { path: { userId: u.id } } })); void refresh(); }}>
                            {t('common.block')}
                          </ConfirmButton>)}
                      {!self && (
                        <ConfirmButton size="xs" variant="subtle" question={t('users.confirmDelete')}
                          onConfirm={async () => { await ok(api.DELETE('/users/{userId}', { params: { path: { userId: u.id } } })); void refresh(); }}>
                          {t('common.delete')}
                        </ConfirmButton>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer></div>
      {list.isError && !list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.refetch()} />}
      {list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.fetchNextPage()} />}
      {list.isPending && <Text c="dimmed">{t('common.loading')}</Text>}
      {list.hasNextPage && <Group><Button variant="default" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t('common.loadMore')}</Button></Group>}
      <InviteModal opened={inviting} onClose={() => setInviting(false)} onDone={refresh} />
      {editing && <EditModal user={editing} self={editing.id === profile?.id} onClose={() => setEditing(null)} onDone={refresh} />}
    </Stack>
  );
}

function InviteModal({ opened, onClose, onDone }: { opened: boolean; onClose: () => void; onDone: () => unknown }) {
  const form = useForm({ initialValues: { email: '', name: '', role: 'tech', language: 'en' } });
  return (
    <Modal opened={opened} onClose={onClose} title={t('users.invite')} centered>
      <form onSubmit={form.onSubmit(async (v) => {
        try {
          await ok(api.POST('/users', { body: { email: v.email.trim(), name: v.name.trim(), role: v.role as 'tech', language: v.language as 'en' } }));
          notifyOk(t('users.invited')); form.reset(); onClose(); void onDone();
        } catch (e) { applyErrors(form, e); }
      })}>
        <Stack>
          <TextInput label={t('common.email')} type="email" required {...form.getInputProps('email')} />
          <TextInput label={t('common.name')} required {...form.getInputProps('name')} />
          <Select label={t('common.role')} data={ROLE_OPTS} allowDeselect={false} {...form.getInputProps('role')} />
          <Select label={t('common.language')} data={LANGS} allowDeselect={false} {...form.getInputProps('language')} />
          <Group justify="flex-end"><Button type="submit" loading={form.submitting}>{t('users.invite')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}

function EditModal({ user, self, onClose, onDone }: { user: User; self: boolean; onClose: () => void; onDone: () => unknown }) {
  const form = useForm({ initialValues: { name: user.name, language: user.language, role: user.role } });
  return (
    <Modal opened onClose={onClose} title={`${t('common.edit')}: ${user.email}`} centered>
      <form onSubmit={form.onSubmit(async (v) => {
        try {
          await ok(api.PATCH('/users/{userId}', { params: { path: { userId: user.id } }, body: {
            name: v.name.trim(), language: v.language, ...(self || v.role === user.role ? {} : { role: v.role }),
          } }));
          notifyOk(); onClose(); void onDone();
        } catch (e) { applyErrors(form, e); }
      })}>
        <Stack>
          <TextInput label={t('common.name')} required {...form.getInputProps('name')} />
          <Select label={t('common.language')} data={LANGS} allowDeselect={false} {...form.getInputProps('language')} />
          <Select label={t('common.role')} data={ROLE_OPTS} allowDeselect={false} disabled={self} {...form.getInputProps('role')} />
          <Group justify="flex-end"><Button type="submit" loading={form.submitting}>{t('common.save')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}
