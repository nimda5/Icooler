// Расписание питания (ТЗ §7.3, «Расписание»): строка autopowerscheduling существующей прошивки.
// w<день 1..7>,<с HH:MM>,<до HH:MM>; — рабочее окно (1 — понедельник … 7 — воскресенье, как в auxilary_devices.c);
// f<0..32>,<начало unix>,<конец unix>; — выходной период. Время окон — местное по timezone.
import { readFileSync } from 'node:fs';

export interface Schedule {
  windows: Map<number, { from: number; to: number }>; // день → минуты от полуночи
  holidays: Map<number, { start: number; end: number }>; // номер → unix-секунды
}

const W = /^w([1-7]),([01][0-9]|2[0-3]):([0-5][0-9]),([01][0-9]|2[0-3]):([0-5][0-9])$/;
const F = /^f([0-9]|[12][0-9]|3[0-2]),([0-9]{1,10}),([0-9]{1,10})$/;

/** Разбор с проверками прошивки; ошибка — текст для code: 400. */
export function parseSchedule(s: string): Schedule | { error: string } {
  const sched: Schedule = { windows: new Map(), holidays: new Map() };
  if (s.length > 1024) return { error: 'invalid value' };
  const parts = s.split(';');
  if (parts.pop() !== '') return { error: 'invalid value' }; // каждая запись заканчивается «;»
  for (const p of parts) {
    let m = W.exec(p);
    if (m) {
      const day = Number(m[1]);
      if (sched.windows.has(day)) return { error: 'invalid value' };
      const from = Number(m[2]) * 60 + Number(m[3]);
      const to = Number(m[4]) * 60 + Number(m[5]);
      sched.windows.set(day, { from, to });
      continue;
    }
    m = F.exec(p);
    if (m) {
      const n = Number(m[1]);
      const start = Number(m[2]), end = Number(m[3]);
      if (sched.holidays.has(n) || start >= end) return { error: 'invalid value' };
      sched.holidays.set(n, { start, end });
      continue;
    }
    return { error: 'invalid value' };
  }
  return sched;
}

const fmt = new Map<string, Intl.DateTimeFormat>();
/** День недели 1..7 и минуты от полуночи по местному времени timezone. */
export function localDayMinute(ms: number, timezone: string): { day: number; minute: number } {
  let f = fmt.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    fmt.set(timezone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(ms).map((p) => [p.type, p.value]));
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts['weekday']!) + 1;
  return { day, minute: Number(parts['hour']) * 60 + Number(parts['minute']) };
}

/**
 * Разрешают ли расписание и энергосбережение работу нагрева и охлаждения сейчас.
 * Энергосбережение выключено — разрешено. Иначе — только в рабочем окне дня и вне выходных (выходной важнее окна);
 * день без окна и расписание без окон — выключено (§7.3: «вне рабочего окна … выключены»).
 */
export function scheduleAllows(ms: number, energySaving: boolean, sched: Schedule | null, timezone: string): boolean {
  if (!energySaving) return true;
  if (!sched) return false; // вне рабочего окна — выключено; окон нет — выключено всегда
  const sec = Math.floor(ms / 1000);
  for (const h of sched.holidays.values()) if (h.start <= sec && sec < h.end) return false;
  const { day, minute } = localDayMinute(ms, timezone);
  const w = sched.windows.get(day);
  return !!w && w.from <= minute && minute < w.to;
}

// Тот же список tzdb, что у контрактов: Intl принимает и псевдонимы ICU вне IANA (ACT, PST).
const IANA = new Set<string>(
  (JSON.parse(readFileSync(new URL('../../contracts/data/iana-timezones.json', import.meta.url), 'utf8')) as { names: string[] }).names,
);
export function isTimezone(tz: string): boolean { return IANA.has(tz); }

let table: Uint32Array | undefined;
/** CRC32 (IEEE) строки UTF-8 — 8 шестнадцатеричных цифр в нижнем регистре. */
export function crc32(s: string): string {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of new TextEncoder().encode(s)) crc = table[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/** CRC для POST schedversion: строка «<timezone>|<расписание>». */
export const scheduleCrc = (timezone: string, schedule: string): string => crc32(`${timezone}|${schedule}`);
