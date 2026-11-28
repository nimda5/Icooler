// Каркас портала: шапка, меню разделов по ролям (V-001), профиль и выход.
import { AppShell, Burger, Group, NavLink, Text, Title, Menu, UnstyledButton, Avatar } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconLayoutDashboard, IconDevices, IconMap, IconBuilding, IconBell, IconChartBar, IconAntenna, IconUsers, IconUserCircle,
  IconHistory, IconSettings, IconBuildingSkyscraper, IconLogout, IconUser,
} from '@tabler/icons-react';
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router';
import { useSession } from './auth/session';
import { can, type OperationId } from './api/roles';
import { t, tx, en } from './i18n';
import { act } from './pages/common';

export interface Section { path: string; label: string; op: OperationId; icon: typeof IconUser }

/** Разделы V-001; видимость — по операции, без которой раздела нет. */
export const SECTIONS: Section[] = [
  { path: 'dashboard', label: t('nav.dashboard'), op: 'getDashboard', icon: IconLayoutDashboard },
  { path: 'devices', label: t('nav.devices'), op: 'listDevices', icon: IconDevices },
  { path: 'map', label: t('nav.map'), op: 'getMap', icon: IconMap },
  { path: 'clients', label: t('nav.clients'), op: 'listClients', icon: IconBuilding },
  { path: 'alerts', label: t('nav.alerts'), op: 'listAlerts', icon: IconBell },
  { path: 'reports', label: t('nav.reports'), op: 'reportConsumption', icon: IconChartBar },
  { path: 'esim', label: t('nav.esim'), op: 'listEsimProfiles', icon: IconAntenna },
  { path: 'users', label: t('nav.users'), op: 'listUsers', icon: IconUsers },
  { path: 'end-users', label: t('nav.endUsers'), op: 'listEndUsers', icon: IconUserCircle },
  { path: 'audit', label: t('nav.audit'), op: 'listAudit', icon: IconHistory },
  { path: 'settings', label: t('nav.settings'), op: 'getSettings', icon: IconSettings },
  { path: 'tenants', label: t('nav.tenants'), op: 'createTenant', icon: IconBuildingSkyscraper },
];

export function Layout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { profile, role, logout } = useSession();
  const loc = useLocation();
  const visible = SECTIONS.filter((s) => can(role, s.op));
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Title order={4}>{t('app.title')}</Title>
            <Text c="dimmed" size="sm" visibleFrom="xs">{t('app.subtitle')}</Text>
          </Group>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <UnstyledButton aria-label={t('nav.profile')}>
                <Group gap="xs">
                  <Avatar size="sm" radius="xl">{profile?.name.slice(0, 1).toUpperCase()}</Avatar>
                  <div style={{ lineHeight: 1.1 }}>
                    <Text size="sm" fw={500}>{profile?.name}</Text>
                    <Text size="xs" c="dimmed">{role ? tx(en.roles, role) : ''}</Text>
                  </div>
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item component={RouterLink} to="/profile" leftSection={<IconUser size={16} />}>{t('nav.profile')}</Menu.Item>
              <Menu.Item onClick={act(() => logout())} leftSection={<IconLogout size={16} />}>{t('nav.logout')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs" aria-label="Sections">
        {visible.map((s) => (
          <NavLink key={s.path} component={RouterLink} to={`/${s.path}`} label={s.label} leftSection={<s.icon size={18} />}
            active={loc.pathname.startsWith(`/${s.path}`)} onClick={close} />
        ))}
      </AppShell.Navbar>
      <AppShell.Main><Outlet /></AppShell.Main>
    </AppShell>
  );
}
