import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import type { ReactNode } from 'react';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from './auth/session';

const theme = createTheme({ primaryColor: 'cyan', defaultRadius: 'md' });

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
}

export function Providers({ children, client = makeQueryClient() }: { children: ReactNode; client?: QueryClient }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <QueryClientProvider client={client}>
        <SessionProvider>{children}</SessionProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
}
