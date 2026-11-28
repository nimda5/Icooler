// Общее для страниц: уведомления об ошибках, дата, подтверждение действий, поля пароля.
import { useState, type ReactNode } from 'react';
import { Alert, Button, Group, Modal, PasswordInput, Stack, Text, Title, type ButtonProps } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { UseFormReturnType } from '@mantine/form';
import { ApiError } from '../api/client';
import { t } from '../i18n';

export function notifyError(e: unknown): void {
  const message = e instanceof ApiError ? e.message : t('common.error');
  notifications.show({ color: 'red', message });
}
export const notifyOk = (message: string = t('common.saved')): void => { notifications.show({ color: 'teal', message }); };

/** Ошибки полей из 422 — в форму (rename: поле API → поле формы); остальное — уведомлением. */
export function applyErrors(form: UseFormReturnType<any>, e: unknown, rename: Record<string, string> = {}): void {
  if (e instanceof ApiError && e.status === 422 && e.problem?.errors?.length) {
    const errs = Object.fromEntries(Object.entries(e.fieldErrors()).map(([k, v]) => [rename[k] ?? k, v]));
    const known = Object.keys(errs).filter((k) => k in (form.values as object));
    if (known.length) form.setErrors(Object.fromEntries(known.map((k) => [k, errs[k]])));
    if (known.length < Object.keys(errs).length) notifyError(e); // ошибка поля, которого нет в форме, — не теряется
  } else notifyError(e);
}

/** Ошибка загрузки: текст и повтор — а не пустой список. */
export function LoadError({ error, retry }: { error: unknown; retry: () => unknown }) {
  return (
    <Alert color="red" role="alert" title={t('common.error')}>
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{error instanceof ApiError ? error.message : String(error)}</Text>
        <Button size="xs" variant="light" color="red" onClick={() => void retry()}>{t('common.retry')}</Button>
      </Stack>
    </Alert>
  );
}

/** Действие кнопки: ошибка — в уведомление, а не в необработанное исключение. */
export const act = (fn: () => Promise<unknown>) => () => { fn().catch(notifyError); };

export const fmt = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : t('common.never'));

/** Заголовок страницы как в демо: надзаголовок, крупное название, подзаголовок; действия справа. */
export function PageTitle({ children, right, sub, eyebrow, back }:
  { children: ReactNode; right?: ReactNode; sub?: ReactNode; eyebrow?: ReactNode; back?: ReactNode }) {
  return (
    <Stack gap={0} mt={6} mb="lg">
      {back}
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
        <div>
          {eyebrow && <div className="ic-eyebrow">{eyebrow}</div>}
          <Title order={2} className="ic-page-title">{children}</Title>
          {sub && <div className="ic-page-sub">{sub}</div>}
        </div>
        {right}
      </Group>
    </Stack>
  );
}

/** Кнопка с подтверждением (блокировка, удаление). */
export function ConfirmButton({ question, onConfirm, children, ...props }:
  { question: string; onConfirm: () => Promise<unknown>; children: ReactNode } & ButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button {...props} onClick={() => setOpen(true)}>{children}</Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={t('common.confirm')} centered>
        <Stack>
          <Text>{question}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button color={props.color ?? 'red'} loading={busy} onClick={async () => {
              setBusy(true);
              try { await onConfirm(); setOpen(false); } catch (e) { notifyError(e); } finally { setBusy(false); }
            }}>{children}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/** Новый пароль с повтором; правило длины — как в контракте (Password: от 12 символов). */
export function newPasswordRules() {
  return {
    password: (v: string) => (v.length >= 12 ? null : t('password.min')),
    repeat: (v: string, all: { password: string }) => (v === all.password ? null : t('password.mismatch')),
  };
}

export function NewPasswordFields({ form }: { form: UseFormReturnType<any> }) {
  return (
    <>
      <PasswordInput label={t('password.new')} description={t('password.min')} autoComplete="new-password" {...form.getInputProps('password')} />
      <PasswordInput label={t('password.repeat')} autoComplete="new-password" {...form.getInputProps('repeat')} />
    </>
  );
}
