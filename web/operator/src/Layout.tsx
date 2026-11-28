// Каркас портала по демо заказчика: боковое меню с логотипом и разделами по ролям (V-001), внизу — пользователь
// (профиль, выход) и светлая/тёмная тема. На телефоне — шапка с кнопкой меню.
import { ActionIcon, AppShell, Avatar, Burger, Group, Menu, ScrollArea, Text, UnstyledButton, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconLayoutDashboard, IconDevices, IconMap, IconBuilding, IconBell, IconChartBar, IconAntenna, IconUsers, IconUserCircle,
  IconHistory, IconSettings, IconBuildingSkyscraper, IconLogout, IconUser, IconSelector, IconMoon, IconSun,
} from '@tabler/icons-react';
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router';
import { useSession } from './auth/session';
import { can, type OperationId } from './api/roles';
import { t, tx, en } from './i18n';
import { act } from './pages/common';

export interface Section { path: string; label: string; op: OperationId; icon: typeof IconUser; group: 'fleet' | 'admin' }

/** Разделы V-001; видимость — по операции, без которой раздела нет. */
export const SECTIONS: Section[] = [
  { path: 'dashboard', label: t('nav.dashboard'), op: 'getDashboard', icon: IconLayoutDashboard, group: 'fleet' },
  { path: 'devices', label: t('nav.devices'), op: 'listDevices', icon: IconDevices, group: 'fleet' },
  { path: 'map', label: t('nav.map'), op: 'getMap', icon: IconMap, group: 'fleet' },
  { path: 'clients', label: t('nav.clients'), op: 'listClients', icon: IconBuilding, group: 'fleet' },
  { path: 'alerts', label: t('nav.alerts'), op: 'listAlerts', icon: IconBell, group: 'fleet' },
  { path: 'reports', label: t('nav.reports'), op: 'reportConsumption', icon: IconChartBar, group: 'fleet' },
  { path: 'esim', label: t('nav.esim'), op: 'listEsimProfiles', icon: IconAntenna, group: 'fleet' },
  { path: 'users', label: t('nav.users'), op: 'listUsers', icon: IconUsers, group: 'admin' },
  { path: 'end-users', label: t('nav.endUsers'), op: 'listEndUsers', icon: IconUserCircle, group: 'admin' },
  { path: 'audit', label: t('nav.audit'), op: 'listAudit', icon: IconHistory, group: 'admin' },
  { path: 'settings', label: t('nav.settings'), op: 'getSettings', icon: IconSettings, group: 'admin' },
  { path: 'tenants', label: t('nav.tenants'), op: 'createTenant', icon: IconBuildingSkyscraper, group: 'admin' },
];

function Logo() {
  return (
    <div>
      <div className="ic-logo">iCooler</div>
      <div className="ic-logo-sub">{t('app.subtitle')}</div>
    </div>
  );
}

function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const label = scheme === 'dark' ? t('nav.light') : t('nav.dark');
  return (
    <ActionIcon variant="default" size={38} radius={11} aria-label={label} title={label} onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}>
      {scheme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
    </ActionIcon>
  );
}

export function Layout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { profile, role, logout } = useSession();
  const loc = useLocation();
  const visible = SECTIONS.filter((s) => can(role, s.op));
  const groups = (['fleet', 'admin'] as const).map((g) => ({ g, items: visible.filter((s) => s.group === g) })).filter((x) => x.items.length);
  return (
    <AppShell header={{ height: { base: 56, sm: 0 } }} navbar={{ width: 252, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding={0}
      styles={{ main: { background: 'var(--bg)' }, navbar: { background: 'var(--sidebar)', borderColor: 'var(--border)' }, header: { background: 'var(--sidebar)', borderColor: 'var(--border)' } }}>
      <AppShell.Header hiddenFrom="sm">
        <Group h="100%" px="md" gap="sm">
          <Burger opened={opened} onClick={toggle} size="sm" aria-label="Menu" />
          <div className="ic-logo" style={{ fontSize: 20 }}>iCooler</div>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md" pt={22} aria-label="Sections">
        <AppShell.Section mb={26} px={10} visibleFrom="sm"><Logo /></AppShell.Section>
        <AppShell.Section grow component={ScrollArea}>
          {groups.map(({ g, items }) => (
            <div key={g} style={{ marginBottom: 18 }}>
              <div className="ic-nav-label">{t(`nav.groups.${g}`)}</div>
              <nav className="ic-nav">
                {items.map((s) => (
                  <RouterLink key={s.path} to={`/${s.path}`} onClick={close} data-active={loc.pathname.startsWith(`/${s.path}`)}>
                    <s.icon size={18} stroke={1.7} />{s.label}
                  </RouterLink>
                ))}
              </nav>
            </div>
          ))}
        </AppShell.Section>
        <AppShell.Section>
          <Group gap={8} wrap="nowrap">
            <Menu position="top-start" withinPortal width={220}>
              <Menu.Target>
                <UnstyledButton aria-label={t('nav.profile')} className="ic-user" style={{ flex: 1, minWidth: 0 }}>
                  <Avatar size={32} radius="xl" color="ink" variant="filled">{profile?.name.slice(0, 2).toUpperCase()}</Avatar>
                  <div style={{ lineHeight: 1.2, minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={600} truncate>{profile?.name}</Text>
                    <Text size="xs" c="dimmed" truncate>{role ? tx(en.roles, role) : ''}</Text>
                  </div>
                  <IconSelector size={14} color="var(--text-3)" />
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item component={RouterLink} to="/profile" onClick={close} leftSection={<IconUser size={16} />}>{t('nav.profile')}</Menu.Item>
                <Menu.Item onClick={act(() => logout())} leftSection={<IconLogout size={16} />}>{t('nav.logout')}</Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <ThemeToggle />
          </Group>
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>
        <div style={{ padding: '8px clamp(16px, 3vw, 32px) 48px', maxWidth: 1560 }}><Outlet /></div>
      </AppShell.Main>
    </AppShell>
  );
}
