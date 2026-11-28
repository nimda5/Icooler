// t('users.title') — текст по ключу. Пока один язык; переводы подключаются тем же набором ключей.
import { en, type Dict } from './en';

type Path<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Path<T[K], `${P}${K}.`>;
}[keyof T & string];

export type Key = Path<Dict>;

export function t(key: Key): string {
  let v: unknown = en;
  for (const part of key.split('.')) v = (v as Record<string, unknown>)[part];
  return typeof v === 'string' ? v : key;
}

/** Текст по динамическому ключу (роль, статус, ключ настройки) — с запасным значением. */
export function tx(group: Record<string, unknown>, k: string): string {
  const v = group[k];
  return typeof v === 'string' ? v : k;
}

export { en };
