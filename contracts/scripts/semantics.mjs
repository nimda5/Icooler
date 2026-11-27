// Проверки, которые JSON Schema выразить не может (ТЗ Stage 1 §7.3, «Расписание»).
// Используются тестом контрактов; те же правила обязаны соблюдать dispatcher, ingest и прошивка.

import { readFileSync } from 'node:fs';

// Список имён tzdb (зоны и ссылки из backward), снят с системной базы — версия в файле.
// Intl не годится: ICU принимает и свои псевдонимы вне IANA (ACT, AET, PST).
const IANA = new Set(JSON.parse(readFileSync(new URL('../data/iana-timezones.json', import.meta.url), 'utf8')).names);

/** Часовой пояс есть в базе IANA (включая ссылки вроде Europe/Kyiv, GMT0, EST5EDT). */
export function timezoneErrors(tz) {
  return IANA.has(tz) ? [] : [`timezone «${tz}» нет в базе IANA`];
}

/** Версия local:<время> — существующая календарная дата (схема проверяет только диапазоны полей). */
export function scheduleVersionErrors(version) {
  const m = /^local:(\d{4})-(\d{2})-(\d{2})T/.exec(version ?? '');
  if (!m) return [];
  const [y, mo, d] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
    ? [] : [`версия ${version}: нет такой даты`];
}

/** Строка autopowerscheduling: не больше одного окна на день, номера выходных уникальны (0..32), начало < конца. */
export function scheduleErrors(schedule) {
  const errors = [];
  const days = new Set();
  const holidays = new Set();
  for (const entry of schedule.split(';').filter(Boolean)) {
    const [head, a, b] = entry.split(',');
    if (head.startsWith('w')) {
      if (days.has(head)) errors.push(`день ${head.slice(1)}: больше одного рабочего окна`);
      days.add(head);
    } else if (head.startsWith('f')) {
      if (holidays.has(head)) errors.push(`выходной ${head.slice(1)}: номер повторяется`);
      holidays.add(head);
      if (Number(a) >= Number(b)) errors.push(`выходной ${head.slice(1)}: начало не раньше конца`);
    }
  }
  return errors;
}

/** Смысловые ошибки сообщения по имени схемы. Сообщение уже прошло схему. */
export function semanticErrors(schemaName, msg) {
  const errors = [];
  const sched = (s) => s !== undefined && errors.push(...scheduleErrors(s));
  const tz = (t) => t !== undefined && errors.push(...timezoneErrors(t));
  const ver = (v) => typeof v === 'string' && errors.push(...scheduleVersionErrors(v));
  if (schemaName === 'command' && msg.op === 'POST') {
    if (msg.param === 'autopowerscheduling') sched(msg.value);
    if (msg.param === 'timezone') tz(msg.value);
  }
  if (schemaName === 'command-result' && msg.param === 'timezone') tz(msg.value);
  if (schemaName === 'command-result' && msg.param === 'schedversion') ver(msg.value);
  if (schemaName === 'hello') { sched(msg.schedule); tz(msg.timezone); ver(msg.schedule_version); }
  if (schemaName === 'event' && msg.type === 'schedule_applied') { sched(msg.data.schedule); tz(msg.data.timezone); ver(msg.data.version); }
  return errors;
}
