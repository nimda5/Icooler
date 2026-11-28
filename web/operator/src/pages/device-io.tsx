// Выгрузка реестра в CSV/XLSX с текущими фильтрами и массовая загрузка устройств из CSV с проверкой и отчётом (V-016).
import { useState } from 'react';
import { Alert, Anchor, Button, FileInput, Group, Menu, Modal, Stack, Table, Text } from '@mantine/core';
import { IconDownload, IconFileTypeCsv, IconUpload } from '@tabler/icons-react';
import { api, ApiError, ok, type Schemas } from '../api/client';
import { t } from '../i18n';
import { notifyError, notifyOk } from './common';

type Report = Schemas['ImportReport'];

/** Скачать Blob как файл (имя — из Content-Disposition, иначе запасное). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = (res: Response, fallback: string) => /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;

/** Кнопка выгрузки: те же фильтры и сортировка, что у списка. */
export function ExportMenu({ query }: { query: Record<string, string> }) {
  const [busy, setBusy] = useState(false);
  const run = async (format: 'csv' | 'xlsx') => {
    setBusy(true);
    try {
      const r = await api.GET('/devices/export', { params: { query: { ...query, format } as never }, parseAs: 'blob' });
      if (!r.response.ok) {
        // ошибка приходит JSON-ом problem+json, но прочитана как Blob
        const problem = r.error instanceof Blob ? JSON.parse(await r.error.text()) : r.error;
        throw new ApiError(r.response.status, problem);
      }
      saveBlob(r.data as Blob, fileName(r.response, `devices.${format}`));
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  };
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button variant="default" leftSection={<IconDownload size={16} />} loading={busy}>{t('io.export')}</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => void run('csv')}>CSV</Menu.Item>
        <Menu.Item onClick={() => void run('xlsx')}>Excel (XLSX)</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** Образец файла: заголовки и две строки. */
export const TEMPLATE = [
  'device_id,serial,imei,water_source,variant,carbonated,sku,hw,ownership,description',
  'vnd-cooler-0101,SIG241101,356938035641101,mains,A,true,SS_POU_CHA,rev C,rent,',
  'vnd-cooler-0102,SIG241102,,bottle_top,A,false,SS_BOT_UP_CHA,rev C,purchase,"Warehouse, shelf B"',
].join('\r\n');

export function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => unknown }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'import');
    try {
      const r = await ok(api.POST('/devices/import', {
        params: { query: { dry_run: dryRun } }, body: { file } as never,
        bodySerializer: (b: { file: File }) => { const fd = new FormData(); fd.append('file', b.file); return fd; },
      } as never)) as Report;
      setReport(r);
      if (!dryRun && r.accepted) { notifyOk(`${t('io.imported')}: ${r.accepted}`); void onDone(); }
    } catch (e) { setReport(null); notifyError(e); } finally { setBusy(null); }
  };
  const checked = report?.dry_run;
  return (
    <Modal opened onClose={onClose} title={t('io.importTitle')} centered size="lg">
      <Stack>
        <Text size="sm" c="dimmed">{t('io.importHint')}</Text>
        <Group gap="xs">
          <IconFileTypeCsv size={16} />
          <Anchor size="sm" component="button" type="button" onClick={() => saveBlob(new Blob(['﻿', TEMPLATE], { type: 'text/csv' }), 'devices-template.csv')}>
            {t('io.template')}
          </Anchor>
        </Group>
        <FileInput label={t('io.file')} placeholder={t('io.choose')} accept=".csv,text/csv" value={file} clearable
          onChange={(f) => { setFile(f); setReport(null); }} leftSection={<IconUpload size={16} />} />
        {report && (
          <Alert color={report.errors.length ? (report.accepted ? 'yellow' : 'red') : 'teal'} variant="light"
            title={checked ? t('io.checkResult') : t('io.importResult')}>
            {checked ? t('io.wouldAccept') : t('io.accepted')}: <b>{report.accepted}</b> / {report.total}
            {report.errors.length > 0 && <> · {t('io.rejected')}: <b>{report.total - report.accepted}</b></>}
          </Alert>
        )}
        {report && report.errors.length > 0 && (
          <Table.ScrollContainer minWidth={420} mah={260}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>{t('io.row')}</Table.Th><Table.Th>{t('io.column')}</Table.Th><Table.Th>{t('io.error')}</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {report.errors.map((e, i) => (
                  <Table.Tr key={`${e.row}-${e.column}-${i}`}><Table.Td>{e.row}</Table.Td><Table.Td><span className="ic-mono">{e.column ?? '—'}</span></Table.Td><Table.Td>{e.message}</Table.Td></Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <Group justify="flex-end">
          <Button variant="default" disabled={!file} loading={busy === 'check'} onClick={() => void send(true)}>{t('io.check')}</Button>
          <Button disabled={!file || busy === 'check'} loading={busy === 'import'} onClick={() => void send(false)}>{t('io.import')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
