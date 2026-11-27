import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, isTimezone, localDayMinute, parseSchedule, scheduleAllows, scheduleCrc } from '../src/schedule.ts';

test('CRC32 — стандартный вектор IEEE', () => {
  assert.equal(crc32('123456789'), 'cbf43926');
  assert.equal(scheduleCrc('Europe/Riga', 'w1,08:30,18:30;'), crc32('Europe/Riga|w1,08:30,18:30;'));
});

test('день недели 1 — понедельник, 7 — воскресенье, по местному времени', () => {
  assert.deepEqual(localDayMinute(Date.parse('2026-12-07T09:00:00Z'), 'Europe/Riga'), { day: 1, minute: 11 * 60 });
  // 23:30 UTC воскресенья — в Риге уже 01:30 понедельника
  assert.deepEqual(localDayMinute(Date.parse('2026-12-06T23:30:00Z'), 'Europe/Riga'), { day: 1, minute: 90 });
  assert.equal(localDayMinute(Date.parse('2026-12-06T12:00:00Z'), 'Europe/Riga').day, 7);
});

test('разбор: окно на день одно, выходные уникальны, начало < конца', () => {
  assert.ok(!('error' in parseSchedule('w1,08:30,18:30;w2,08:30,18:30;f0,1804284000,1804456800;')));
  assert.ok('error' in parseSchedule('w1,08:30,18:30;w1,09:00,10:00;'));
  assert.ok('error' in parseSchedule('f0,10,20;f0,30,40;'));
  assert.ok('error' in parseSchedule('f0,20,10;'));
  assert.ok('error' in parseSchedule('w1,08:30,18:30'));
  assert.ok('error' in parseSchedule('w8,08:30,18:30;'));
});

test('расписание: окно, день без окна, выходной важнее окна, энергосбережение выключено', () => {
  const s = parseSchedule('w1,08:30,18:30;f0,1796637600,1796680800;'); // выходной 2026-12-07 12:00–24:00 по Риге
  assert.ok(!('error' in s));
  const at = (iso: string) => Date.parse(iso);
  assert.equal(scheduleAllows(at('2026-12-07T09:00:00Z'), true, s, 'Europe/Riga'), true); // пн 11:00
  assert.equal(scheduleAllows(at('2026-12-07T05:00:00Z'), true, s, 'Europe/Riga'), false); // пн 07:00 — до окна
  assert.equal(scheduleAllows(at('2026-12-08T09:00:00Z'), true, s, 'Europe/Riga'), false); // вт — нет окна
  assert.equal(scheduleAllows(at('2026-12-07T11:00:00Z'), true, s, 'Europe/Riga'), false); // пн 13:00 — выходной
  assert.equal(scheduleAllows(at('2026-12-08T09:00:00Z'), false, s, 'Europe/Riga'), true); // энергосбережение выкл.
  assert.equal(scheduleAllows(at('2026-12-08T09:00:00Z'), true, null, 'Europe/Riga'), false); // окон нет — выключено
  const onlyHolidays = parseSchedule('f0,1,2;');
  assert.ok(!('error' in onlyHolidays));
  assert.equal(scheduleAllows(at('2026-12-07T09:00:00Z'), true, onlyHolidays, 'Europe/Riga'), false);
});

test('часовой пояс — по списку tzdb контрактов: ссылки IANA да, псевдонимы ICU нет', () => {
  for (const tz of ['Europe/Riga', 'Europe/Kyiv', 'Etc/GMT-3', 'GMT0', 'EST5EDT']) assert.ok(isTimezone(tz), tz);
  for (const tz of ['ACT', 'PST', 'Europe/Nowhere', '']) assert.ok(!isTimezone(tz), tz);
});
