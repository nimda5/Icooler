// Вход, восстановление пароля, новый пароль по ссылке, принятие приглашения (V-002, §7.5).
import { useState, type ReactNode } from 'react';
import { Alert, Anchor, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, ok, ApiError } from '../api/client';
import { useSession } from '../auth/session';
import { t } from '../i18n';
import { applyErrors, NewPasswordFields, newPasswordRules } from './common';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={420}>
        <Stack>
          <div>
            <Text c="dimmed" size="sm">{t('app.title')} · {t('app.subtitle')}</Text>
            <Title order={2}>{title}</Title>
          </div>
          {children}
        </Stack>
      </Paper>
    </Center>
  );
}

export function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ initialValues: { email: '', password: '' } });
  return (
    <Card title={t('login.title')}>
      <form onSubmit={form.onSubmit(async (v) => {
        setError(null);
        try {
          await login(v.email.trim(), v.password);
          navigate(loc.state?.from ?? '/', { replace: true });
        } catch (e) {
          const s = e instanceof ApiError ? e.status : 0;
          setError(s === 423 ? t('login.locked') : s === 429 ? t('login.tooMany') : s === 401 || s === 422 ? t('login.wrong') : t('common.error'));
        }
      })}>
        <Stack>
          {error && <Alert color="red" role="alert">{error}</Alert>}
          <TextInput label={t('common.email')} type="email" autoComplete="username" required {...form.getInputProps('email')} />
          <PasswordInput label={t('login.password')} autoComplete="current-password" required {...form.getInputProps('password')} />
          <Button type="submit" loading={form.submitting}>{t('login.submit')}</Button>
          <Anchor component={Link} to="/forgot" size="sm">{t('login.forgot')}</Anchor>
        </Stack>
      </form>
    </Card>
  );
}

export function ForgotPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ initialValues: { email: '' } });
  return (
    <Card title={t('forgot.title')}>
      {sent ? <Alert color="teal">{t('forgot.sent')}</Alert> : (
        <form onSubmit={form.onSubmit(async (v) => {
          setError(null);
          try { await ok(api.POST('/auth/password/forgot', { body: { email: v.email.trim() } })); setSent(true); } catch (e) {
            setError(e instanceof ApiError && e.status === 429 ? t('login.tooMany') : t('common.error'));
          }
        })}>
          <Stack>
            {error && <Alert color="red" role="alert">{error}</Alert>}
            <TextInput label={t('common.email')} type="email" required {...form.getInputProps('email')} />
            <Button type="submit" loading={form.submitting}>{t('forgot.submit')}</Button>
          </Stack>
        </form>
      )}
      <Anchor component={Link} to="/login" size="sm">{t('forgot.back')}</Anchor>
    </Card>
  );
}

/** Новый пароль по ссылке из письма: сброс пароля или приглашение. */
function TokenPassword({ kind }: { kind: 'reset' | 'invite' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { acceptSession } = useSession();
  // Токен ссылки — как в контракте (TokenPassword.token: 16–256 символов); иначе ссылка недействительна сразу.
  const [state, setState] = useState<'form' | 'done' | 'invalid'>(token.length >= 16 && token.length <= 256 ? 'form' : 'invalid');
  const form = useForm({ initialValues: { password: '', repeat: '' }, validate: newPasswordRules() });
  const invalid = kind === 'reset' ? t('reset.invalid') : t('invite.invalid');
  return (
    <Card title={kind === 'reset' ? t('reset.title') : t('invite.title')}>
      {state === 'invalid' && <Alert color="red" role="alert">{invalid}</Alert>}
      {state === 'done' && <Alert color="teal">{t('reset.done')}</Alert>}
      {state === 'form' && (
        <form onSubmit={form.onSubmit(async (v) => {
          try {
            if (kind === 'reset') {
              await ok(api.POST('/auth/password/reset', { body: { token, password: v.password } }));
              setState('done');
            } else {
              await acceptSession(await ok(api.POST('/auth/invitations/accept', { body: { token, password: v.password } })));
              navigate('/', { replace: true });
            }
          } catch (e) {
            const tokenError = e instanceof ApiError && e.status === 422 && 'token' in e.fieldErrors();
            if ((e instanceof ApiError && e.status === 410) || tokenError) setState('invalid');
            else applyErrors(form, e);
          }
        })}>
          <Stack>
            <NewPasswordFields form={form} />
            <Button type="submit" loading={form.submitting}>{kind === 'reset' ? t('reset.submit') : t('invite.submit')}</Button>
          </Stack>
        </form>
      )}
      <Anchor component={Link} to="/login" size="sm">{t('forgot.back')}</Anchor>
    </Card>
  );
}

export const ResetPage = () => <TokenPassword kind="reset" />;
export const InvitePage = () => <TokenPassword kind="invite" />;
