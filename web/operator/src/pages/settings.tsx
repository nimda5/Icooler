// Настройки платформы V-006 (§7.4), Admin: значения арендатора с уровнем, сброс к унаследованному.
import { Badge, Button, Group, NumberInput, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ok, sessionGen, ApiError, type Schemas } from '../api/client';
import { en, t, tx } from '../i18n';
import { LoadError, notifyError, notifyOk, PageTitle } from './common';

type Settings = Schemas['Settings'];
type Key = keyof Settings & keyof Schemas['SettingsWrite'];

/** Группы и границы — как в схеме SettingsWrite контракта. */
export const GROUPS: { title: string; keys: { key: Key; min: number; max: number; step: number }[] }[] = [
  { title: t('settings.sections.offline'), keys: [
    { key: 'offline_after_min', min: 1, max: 60, step: 1 }, { key: 'offline_alert_after_min', min: 1, max: 1440, step: 1 }] },
  { title: t('settings.sections.hot'), keys: [
    { key: 'hot_alert_below_set_c', min: 1, max: 50, step: 0.5 }, { key: 'hot_alert_above_c', min: 90, max: 110, step: 0.5 },
    { key: 'hot_alert_after_min', min: 1, max: 240, step: 1 }] },
  { title: t('settings.sections.cold'), keys: [
    { key: 'cold_alert_above_set_c', min: 1, max: 30, step: 0.5 }, { key: 'cold_alert_below_c', min: -5, max: 10, step: 0.5 },
    { key: 'cold_alert_after_min', min: 1, max: 240, step: 1 }] },
  { title: t('settings.sections.filter'), keys: [
    { key: 'filter_warning_pct', min: 0, max: 100, step: 1 }, { key: 'filter_critical_pct', min: 0, max: 100, step: 1 },
    { key: 'upcoming_filters_days', min: 1, max: 366, step: 1 }, { key: 'filter_forecast_window_days', min: 7, max: 365, step: 1 }] },
];

export function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => ok(api.GET('/settings')) });
  // Черновик: число или '' (поле очищено при вводе — не путать с «сбросить к унаследованному», это отдельная кнопка).
  const [draft, setDraft] = useState<Partial<Record<Key, number | ''>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Сохранение и сброс — по одному: пока идёт запрос, обе кнопки выключены, поздний ответ не перезапишет следующий.
  const save = async (body: Partial<Record<Key, number | null>>) => {
    if (busy) return;
    setBusy(true);
    const gen = sessionGen.current();
    const snap = { ...draft }; // черновик на момент отправки
    try {
      const r = await ok(api.PATCH('/settings', { body }));
      if (gen !== sessionGen.current()) return; // ответ прежней сессии — не в кэш новой
      qc.setQueryData(['settings'], r);
      // Убрать из черновика отправленные поля, если их не правили за время сохранения (сброс тоже убирает
      // черновик своего поля); прочие правки остаются.
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !(k in body) || v !== snap[k as Key])));
      setErrors((er) => Object.fromEntries(Object.entries(er).filter(([k]) => !(k in body))));
      notifyOk();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(e.fieldErrors());
      notifyError(e);
    } finally { setBusy(false); }
  };
  const values = Object.values(draft);
  const ready = values.length > 0 && values.every((v) => typeof v === 'number') && !busy;
  if (q.isError) return <LoadError error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Text c="dimmed">{t('common.loading')}</Text>;
  const s = q.data;
  return (
    <Stack maw={900}>
      <PageTitle right={<Button onClick={() => void save(draft as Partial<Record<Key, number>>)} disabled={!ready} loading={busy}>{t('common.save')}</Button>}>
        {t('settings.title')}
      </PageTitle>
      {GROUPS.map((g) => (
        <Paper key={g.title} withBorder p="md">
          <Title order={4} mb="sm">{g.title}</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {g.keys.map(({ key, min, max, step }) => {
              const cur = s[key];
              return (
                <Stack key={key} gap={4}>
                  <NumberInput label={tx(en.settings.keys, key)} min={min} max={max} step={step} allowDecimal={step < 1}
                    value={key in draft ? draft[key] : cur.value} error={errors[key] ?? (draft[key] === '' ? t('settings.required') : undefined)}
                    disabled={busy}
                    onChange={(v) => setDraft((d) => ({ ...d, [key]: typeof v === 'number' ? v : '' }))} />
                  <Group gap="xs">
                    <Badge size="sm" variant="light" color={cur.level === 'platform' ? 'gray' : 'cyan'}>{tx(en.settings.levels, cur.level)}</Badge>
                    {cur.level === 'tenant' && (
                      <Button size="compact-xs" variant="subtle" disabled={busy} onClick={() => void save({ [key]: null })}>{t('settings.reset')}</Button>
                    )}
                  </Group>
                </Stack>
              );
            })}
          </SimpleGrid>
        </Paper>
      ))}
    </Stack>
  );
}
