// Тема Mantine по демо заказчика: Inter, чёрный акцент, нейтральные серые, скругления 10/14/20 px.
import '@fontsource-variable/inter';
import { createTheme, type MantineColorsTuple } from '@mantine/core';

const ink: MantineColorsTuple = ['#f4f4f5', '#e4e5e9', '#c6c8ce', '#a3a5ac', '#8e9098', '#6c6e76', '#55575e', '#2a2b2f', '#19191c', '#0b0b0c'];

export const theme = createTheme({
  fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
  headings: { fontWeight: '750', sizes: { h2: { fontSize: '32px', lineHeight: '1.1' }, h4: { fontSize: '15px', lineHeight: '1.3' } } },
  colors: { ink },
  primaryColor: 'ink',
  primaryShade: { light: 9, dark: 2 },
  autoContrast: true,
  defaultRadius: 10,
  radius: { xs: '6px', sm: '8px', md: '10px', lg: '14px', xl: '20px' },
  black: '#0b0b0c',
  components: {
    Button: { defaultProps: { radius: 10 }, styles: { root: { fontWeight: 560 } } },
    Card: { defaultProps: { radius: 20, withBorder: true }, styles: { root: { background: 'var(--elev)', borderColor: 'var(--border)', boxShadow: 'var(--shadow)' } } },
    Modal: { defaultProps: { radius: 20 }, styles: { title: { fontWeight: 650, fontSize: 16, letterSpacing: '-.015em' } } },
    Input: { defaultProps: { radius: 11 } },
    Badge: { styles: { root: { textTransform: 'none', fontWeight: 600 } } },
    Alert: { defaultProps: { radius: 14 } },
    Table: { defaultProps: { className: 'ic-table', highlightOnHover: false, striped: false } },
  },
});
