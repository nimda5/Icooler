// Свой профиль: имя, язык, пароль, выход со всех устройств (§7.1 «Свой профиль», V-002).
import { Button, Divider, Group, Paper, PasswordInput, Select, Stack, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { api, ok } from '../api/client';
import { useSession } from '../auth/session';
import { en, t } from '../i18n';
import { act, applyErrors, NewPasswordFields, newPasswordRules, notifyOk, PageTitle } from './common';
import { sessionGen } from '../api/client';

const LANGS = Object.entries(en.languages).map(([value, label]) => ({ value, label }));

export function ProfilePage() {
  const { profile, setProfile, logout } = useSession();
  const form = useForm({ initialValues: { name: profile?.name ?? '', language: profile?.language ?? 'en' } });
  const pw = useForm({ initialValues: { current: '', password: '', repeat: '' }, validate: newPasswordRules() });
  return (
    <Stack maw={520}>
      <PageTitle>{t('profile.title')}</PageTitle>
      <Paper withBorder p="md">
        <form onSubmit={form.onSubmit(async (v) => {
          const gen = sessionGen.current();
          try {
            setProfile(await ok(api.PATCH('/me', { body: { name: v.name.trim(), language: v.language as 'en' } })), gen);
            notifyOk();
          } catch (e) { applyErrors(form, e); }
        })}>
          <Stack>
            <TextInput label={t('common.email')} value={profile?.email ?? ''} readOnly />
            <TextInput label={t('common.name')} required {...form.getInputProps('name')} />
            <Select label={t('common.language')} data={LANGS} allowDeselect={false} {...form.getInputProps('language')} />
            <Group justify="flex-end"><Button type="submit" loading={form.submitting}>{t('common.save')}</Button></Group>
          </Stack>
        </form>
      </Paper>
      <Paper withBorder p="md">
        <Title order={4} mb="sm">{t('password.change')}</Title>
        <form onSubmit={pw.onSubmit(async (v) => {
          try {
            await ok(api.PUT('/me/password', { body: { current_password: v.current, new_password: v.password } }));
            pw.reset();
            notifyOk(t('password.changed'));
          } catch (e) { applyErrors(pw, e, { current_password: 'current', new_password: 'password' }); }
        })}>
          <Stack>
            <PasswordInput label={t('password.current')} autoComplete="current-password" required {...pw.getInputProps('current')} />
            <NewPasswordFields form={pw} />
            <Group justify="flex-end"><Button type="submit" loading={pw.submitting}>{t('password.change')}</Button></Group>
          </Stack>
        </form>
      </Paper>
      <Divider />
      <Group><Button variant="light" color="red" onClick={act(() => logout(true))}>{t('profile.logoutAll')}</Button></Group>
    </Stack>
  );
}
