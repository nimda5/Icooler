import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { notifications } from '@mantine/notifications';

// Уведомления Mantine — глобальная очередь (до 5 на экране): без очистки уведомления прошлых тестов вытесняют новые.
afterEach(() => { cleanup(); localStorage.clear(); notifications.clean(); notifications.cleanQueue(); });

// jsdom: Mantine использует matchMedia и ResizeObserver.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
});
class RO { observe() {} unobserve() {} disconnect() {} }
(window as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
window.scrollTo = () => {};
// jsdom: выпадающий список Mantine прокручивает к выбранному пункту.
Element.prototype.scrollIntoView = function scrollIntoView() {};
