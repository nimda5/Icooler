import { Alert, Anchor, Stack } from '@mantine/core';
import { Link } from 'react-router';
import { t } from '../i18n';
import { PageTitle } from './common';

/** Раздел V-001, экраны которого появятся со своей частью API. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <Stack>
      <PageTitle>{title}</PageTitle>
      <Alert color="gray">{t('common.soon')}</Alert>
    </Stack>
  );
}

export function NotFound() {
  return (
    <Stack>
      <PageTitle>{t('common.notFound')}</PageTitle>
      <Anchor component={Link} to="/">{t('common.back')}</Anchor>
    </Stack>
  );
}
