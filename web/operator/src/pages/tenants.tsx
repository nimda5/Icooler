// Создание арендатора и приглашение его первого Admin (SIG Administrator, §2).
import { Button, Group, Paper, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { api, ok } from '../api/client';
import { t } from '../i18n';
import { applyErrors, notifyOk, PageTitle } from './common';

export function TenantsPage() {
  const form = useForm({
    initialValues: { name: '', code: '', admin_email: '', admin_name: '' },
    validate: { code: (v) => (/^[a-z0-9-]{2,32}$/.test(v) ? null : 'a–z, 0–9, -; 2–32') },
  });
  return (
    <Stack maw={520}>
      <PageTitle>{t('nav.tenants')}</PageTitle>
      <Paper withBorder p="md">
        <form onSubmit={form.onSubmit(async (v) => {
          try {
            await ok(api.POST('/tenants', { body: { name: v.name.trim(), code: v.code, admin_email: v.admin_email.trim(), admin_name: v.admin_name.trim() } }));
            notifyOk(t('users.invited')); form.reset();
          } catch (e) { applyErrors(form, e); }
        })}>
          <Stack>
            <TextInput label={t('common.name')} required {...form.getInputProps('name')} />
            <TextInput label="Code" required {...form.getInputProps('code')} />
            <TextInput label={`Admin ${t('common.email')}`} type="email" required {...form.getInputProps('admin_email')} />
            <TextInput label={`Admin ${t('common.name')}`} required {...form.getInputProps('admin_name')} />
            <Group justify="flex-end"><Button type="submit" loading={form.submitting}>{t('common.save')}</Button></Group>
          </Stack>
        </form>
      </Paper>
    </Stack>
  );
}
