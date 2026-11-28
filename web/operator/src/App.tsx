// Маршруты портала оператора. Разделы — V-001; в меню только разрешённые роли (x-roles контракта).
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Center, Loader } from '@mantine/core';
import { useSession } from './auth/session';
import { Layout, SECTIONS } from './Layout';
import { can } from './api/roles';
import { LoginPage, ForgotPage, ResetPage, InvitePage } from './pages/auth';
import { ProfilePage } from './pages/profile';
import { UsersPage } from './pages/users';
import { EndUsersPage } from './pages/end-users';
import { AuditPage } from './pages/audit';
import { SettingsPage } from './pages/settings';
import { TenantsPage } from './pages/tenants';
import { ComingSoon, NotFound } from './pages/misc';

const PAGES: Record<string, () => React.JSX.Element> = {
  users: UsersPage, 'end-users': EndUsersPage, audit: AuditPage, settings: SettingsPage, tenants: TenantsPage,
};

function Protected({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Center h="100vh"><Loader /></Center>;
  if (!profile) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

function Home() {
  const { role } = useSession();
  const first = SECTIONS.find((s) => can(role, s.op));
  return <Navigate to={first ? `/${first.path}` : '/profile'} replace />;
}

export function App() {
  const { role } = useSession();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot" element={<ForgotPage />} />
      <Route path="/reset-password" element={<ResetPage />} />
      <Route path="/invite" element={<InvitePage />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Home />} />
        <Route path="profile" element={<ProfilePage />} />
        {SECTIONS.map((s) => {
          const Page = PAGES[s.path];
          return (
            <Route key={s.path} path={s.path}
              element={!can(role, s.op) ? <NotFound /> : Page ? <Page /> : <ComingSoon title={s.label} />} />
          );
        })}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
