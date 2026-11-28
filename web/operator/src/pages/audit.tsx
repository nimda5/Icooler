// Журнал аудита (V-005): кто, что, над чем, до/после, IP; фильтр по действию, пользователю, периоду. Admin, Exec.
import { useState } from 'react';
import { Button, Code, Group, Stack, Table, Text, TextInput } from '@mantine/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, ok } from '../api/client';
import { t } from '../i18n';
import { fmt, LoadError, PageTitle } from './common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

export function AuditPage() {
  const [action, setAction] = useState('');
  const [user, setUser] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = {
    ...(action ? { action } : {}), ...(UUID.test(user) ? { user_id: user } : {}),
    ...(toIso(from) ? { from: toIso(from)! } : {}), ...(toIso(to) ? { to: toIso(to)! } : {}),
  };
  const list = useInfiniteQuery({
    queryKey: ['audit', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => ok(api.GET('/audit-log', { params: { query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <Stack>
      <PageTitle>{t('audit.title')}</PageTitle>
      <Group align="flex-end">
        <TextInput label={t('audit.action')} placeholder="user.block" value={action} onChange={(e) => setAction(e.currentTarget.value.trim())} />
        <TextInput label={t('audit.user')} placeholder="UUID" value={user} onChange={(e) => setUser(e.currentTarget.value.trim())}
          error={user && !UUID.test(user) ? 'UUID' : undefined} />
        <TextInput label={t('audit.from')} type="datetime-local" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
        <TextInput label={t('audit.to')} type="datetime-local" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
      </Group>
      <div className="ic-card" style={{ padding: '4px 6px' }}><Table.ScrollContainer minWidth={800}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('audit.at')}</Table.Th><Table.Th>{t('audit.action')}</Table.Th><Table.Th>{t('audit.object')}</Table.Th>
              <Table.Th>{t('audit.user')}</Table.Th><Table.Th>{t('audit.ip')}</Table.Th><Table.Th>{t('audit.details')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>{fmt(e.at)}</Table.Td>
                <Table.Td><Code>{e.action}</Code></Table.Td>
                <Table.Td>{e.object_type}{e.object_id ? ` ${e.object_id.slice(0, 8)}…` : ''}</Table.Td>
                <Table.Td>{e.user_id ? `${e.user_id.slice(0, 8)}…` : '—'}</Table.Td>
                <Table.Td>{e.ip ?? '—'}</Table.Td>
                <Table.Td>
                  {(e.before != null || e.after != null) && (
                    <Code block fz="xs" maw={380} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify({ before: e.before ?? undefined, after: e.after ?? undefined }, null, 1)}</Code>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer></div>
      {list.isError && !list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.refetch()} />}
      {list.isFetchNextPageError && <LoadError error={list.error} retry={() => list.fetchNextPage()} />}
      {list.isSuccess && items.length === 0 && <Text c="dimmed">{t('audit.empty')}</Text>}
      {list.hasNextPage && <Group><Button variant="default" onClick={() => void list.fetchNextPage()}>{t('common.loadMore')}</Button></Group>}
    </Stack>
  );
}
