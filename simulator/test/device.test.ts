// Поведение виртуального устройства по ТЗ §7.3, FW-5, FW-10. Каждое сообщение проверяется по контрактам (Bench).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bench, MIN, T0 } from './harness.ts';
import { scheduleCrc } from '../src/schedule.ts';

const HOUR = 60 * MIN;

test('старт: hello, затем reboot, кадры раз в 5 мин (первый — с fw/hw), heartbeat раз в минуту, seq растёт', () => {
  const b = new Bench().start();
  b.run(HOUR);
  assert.equal(b.got[0]!.msg.mt, 'hello');
  assert.equal(b.events('reboot')[0]!.code, 'power');
  const frames = b.of('frame');
  assert.ok(frames.length >= 11 && frames.length <= 13, `кадров ${frames.length}`);
  assert.ok(frames[0]!.fw && frames[0]!.hw);
  assert.ok(frames.slice(1).every((f) => f.fw === undefined && f.hw === undefined));
  assert.ok(b.of('heartbeat').length >= 59);
  const seqs = b.got.filter((d) => d.msg.mt === 'frame' || d.msg.mt === 'event').map((d) => (d.msg.body as { seq: number }).seq);
  assert.ok(seqs.every((x, i) => i === 0 || x > seqs[i - 1]!), 'seq растёт в порядке прихода');
});

test('GET all: ack, {code: 200} и внеочередной кадр с cmd_id; повтор — тот же кадр с тем же seq', () => {
  const b = new Bench().start();
  const id = b.send('GET', 'all');
  b.run(1000);
  assert.equal(b.acks(id).length, 1);
  assert.deepEqual(b.results(id), [{ v: 0, cmd_id: id, code: 200 }]);
  const f = b.of('frame').filter((x) => x.cmd_id === id);
  assert.equal(f.length, 1);
  b.send('GET', 'all', undefined, { id });
  b.run(1000);
  assert.equal(b.acks(id).length, 2);
  assert.equal(b.results(id).length, 2);
  const again = b.of('frame').filter((x) => x.cmd_id === id);
  assert.equal(again.length, 2);
  assert.equal(again[1]!.seq, f[0]!.seq);
});

test('hottank:0 — applied: pushed и controller_confirmed с uart_ms; кадр показывает выключенный нагрев', () => {
  const b = new Bench().start();
  b.run(2 * MIN);
  const id = b.send('POST', 'hottank', '0');
  b.run(5000);
  assert.deepEqual(b.results(id), [{ v: 0, cmd_id: id, code: 200, applied: 'pushed' }]);
  const c = b.events('controller_confirmed').find((e) => e.data!['cmd_id'] === id)!;
  assert.equal(c.data!['heat_on'], false);
  assert.ok((c.data!['uart_ms'] as number) >= 200);
  b.run(6 * MIN);
  const last = b.of('frame').at(-1)!;
  assert.equal(last.heat_enabled, false);
  assert.equal(last.heat_on, false);
});

test('power:0, затем hottank:1 — applied: flag_only, подтверждения нет', () => {
  const b = new Bench().start();
  b.run(2 * MIN);
  const p = b.send('POST', 'power', '0');
  b.run(5000);
  assert.equal(b.results(p)[0]!.applied, 'pushed');
  const h = b.send('POST', 'hottank', '1');
  b.run(35_000);
  assert.equal(b.results(h)[0]!.applied, 'flag_only');
  assert.equal(b.of('event').filter((e) => e.data?.['cmd_id'] === h).length, 0);
});

test('контроллер молчит — результат 200 pushed, к сроку controller_not_confirmed', () => {
  const b = new Bench().start();
  b.run(2 * MIN);
  b.device.faults.controllerSilent = true;
  const id = b.send('POST', 'coldtank', '0');
  b.run(31_000);
  assert.equal(b.results(id)[0]!.applied, 'pushed');
  assert.equal(b.events('controller_not_confirmed').filter((e) => e.data!['cmd_id'] === id).length, 1);
  assert.equal(b.events('controller_confirmed').length, 0);
});

test('срок прошёл — deadline passed; команда не исполняется', () => {
  const b = new Bench().start();
  const id = b.send('POST', 'otaallowed', '1', { deadlineMs: -1000 });
  b.run(1000);
  assert.deepEqual(b.results(id), [{ v: 0, cmd_id: id, code: 400, message: 'deadline passed' }]);
  assert.equal(b.device.state.otaAllowed, false);
});

test('расписание: timezone → autopowerscheduling → schedversion с верным CRC → schedule_applied platform', () => {
  const b = new Bench().start();
  const tz = 'Europe/Vilnius', s = 'w1,08:30,18:30;w2,08:30,18:30;';
  const ids = [b.send('POST', 'timezone', tz)];
  b.run(1000);
  ids.push(b.send('POST', 'autopowerscheduling', s));
  b.run(1000);
  assert.match(b.device.state.scheduleVersion!, /^local:/);
  ids.push(b.send('POST', 'schedversion', `12,${scheduleCrc(tz, s)}`));
  b.run(1000);
  for (const id of ids) assert.equal(b.results(id)[0]!.code, 200);
  assert.deepEqual(b.events('schedule_applied').at(-1)!.data, { version: '12', source: 'platform' });
  const g = b.send('GET', 'schedversion');
  b.run(1000);
  assert.deepEqual(b.results(g)[0], { v: 0, cmd_id: g, code: 200, param: 'schedversion', value: '12' });
});

test('schedversion с чужим CRC — schedule changed, версия остаётся локальной', () => {
  const b = new Bench().start();
  b.send('POST', 'autopowerscheduling', 'w1,08:30,18:30;');
  b.run(1000);
  const id = b.send('POST', 'schedversion', `13,${scheduleCrc('Europe/Riga', 'w2,08:30,18:30;')}`);
  b.run(1000);
  assert.deepEqual(b.results(id)[0], { v: 0, cmd_id: id, code: 400, message: 'schedule changed' });
  assert.match(b.device.state.scheduleVersion!, /^local:/);
});

test('изменение на месте: schedule_applied local с содержимым; hello после переподключения несёт расписание', () => {
  const b = new Bench({ schedule: 'w1,08:00,17:00;', scheduleVersion: '5', energySaving: true }).start();
  assert.equal(b.of('hello')[0]!.schedule_version, '5');
  assert.equal(b.of('hello')[0]!.schedule, undefined);
  b.device.localScheduleEdit('w1,07:00,20:00;');
  b.run(1000);
  const e = b.events('schedule_applied').at(-1)!;
  assert.equal(e.data!['source'], 'local');
  assert.equal(e.data!['schedule'], 'w1,07:00,20:00;');
  b.device.lteLoss(MIN);
  b.run(2 * MIN);
  const h = b.of('hello').at(-1)!;
  assert.match(h.schedule_version!, /^local:/);
  assert.equal(h.schedule, 'w1,07:00,20:00;');
  assert.equal(h.timezone, 'Europe/Riga');
});

test('ошибка записи расписания — schedule save failed, действует прежнее', () => {
  const b = new Bench({ schedule: 'w1,08:00,17:00;', scheduleVersion: '5' }).start();
  b.device.faults.nvsFail = true;
  const id = b.send('POST', 'autopowerscheduling', 'w1,07:00,20:00;');
  b.run(1000);
  assert.equal(b.results(id)[0]!.message, 'schedule save failed');
  assert.equal(b.device.state.schedule, 'w1,08:00,17:00;');
  assert.equal(b.device.state.scheduleVersion, '5');
});

test('вне рабочего окна при энергосбережении: нагрев выключен, hottank:1 — flag_only', () => {
  const b = new Bench({ schedule: 'w2,08:00,17:00;', scheduleVersion: '1', energySaving: true }).start(); // сегодня пн
  b.run(2 * MIN);
  assert.deepEqual(b.device.state.ctrl, { heat: false, cool: false });
  const id = b.send('POST', 'hottank', '1');
  b.run(1000);
  assert.equal(b.results(id)[0]!.applied, 'flag_only');
  const e = b.send('POST', 'energysaving', '0');
  b.run(2 * MIN);
  assert.equal(b.results(e)[0]!.code, 200);
  assert.deepEqual(b.device.state.ctrl, { heat: true, cool: true });
});

test('перезагрузка во время selftest — interrupted by reboot приходит сам; повтор cmd_id — ack и тот же результат', () => {
  const b = new Bench().start();
  const id = b.send('POST', 'selftest', '1');
  b.run(1000); // selftest идёт 3 с
  assert.equal(b.results(id).length, 0);
  b.device.reboot('watchdog');
  b.run(10_000);
  // После ack платформа не повторяет команду (п. 3) — результат приходит сам после подключения.
  assert.deepEqual(b.results(id), [{ v: 0, cmd_id: id, code: 400, message: 'interrupted by reboot' }]);
  b.send('POST', 'selftest', '1', { id });
  b.run(1000);
  assert.equal(b.acks(id).length, 2);
  assert.equal(b.results(id).length, 2);
  assert.equal(b.results(id)[1]!.message, 'interrupted by reboot');
  assert.equal(b.events('reboot').at(-1)!.code, 'watchdog');
});

test('selftest: проверки ok, у модели с газированной водой — и co2', () => {
  const b = new Bench().start();
  const id = b.send('POST', 'selftest', '1');
  b.run(4000);
  const r = b.results(id)[0]!;
  assert.equal(r.code, 200);
  assert.deepEqual(Object.keys(r.checks!).sort(), ['clock', 'co2', 'controller_link', 'modem', 'nvs', 'signal']);
});

test('неизвестная команда — 400; без cmd_id — отбрасывается без ack', () => {
  const b = new Bench().start();
  const deadline_at = new Date(b.clock.now() + 30_000).toISOString();
  b.send('POST', 'pin1', '1234', { id: 'x1', raw: { v: 0, cmd_id: 'x1', deadline_at, op: 'POST', param: 'pin1', value: '1234' } });
  b.send('GET', 'all', undefined, { raw: { v: 0, deadline_at, op: 'GET', param: 'all' } });
  b.hub.sendCommand('dev-1', 'не json');
  b.run(1000);
  assert.deepEqual(b.results('x1'), [{ v: 0, cmd_id: 'x1', code: 400, message: 'unknown command' }]);
  assert.equal(b.of('ack').length, 1);
  assert.equal(b.device.stats.dropped, 2);
});

test('filterreset сбрасывает ресурс фильтра, общий счётчик воды не трогает; B1 поднимается и снимается', () => {
  const b = new Bench({ filterUsedL: 24_999.9, usage: 20 }).start();
  b.run(3 * HOUR);
  assert.equal(b.events('error_raised').filter((e) => e.code === 'B1').length, 1);
  const before = b.device.state.waterTotal;
  const id = b.send('POST', 'filterreset', '1');
  b.run(2 * MIN);
  assert.equal(b.results(id)[0]!.code, 200);
  assert.ok(b.device.state.waterTotal >= before);
  assert.ok(b.device.state.filterUsed < 50);
  assert.equal(b.events('error_cleared').filter((e) => e.code === 'B1').length, 1);
});

test('общий счётчик воды не уменьшается; seq переживает перезагрузку', () => {
  const b = new Bench({ usage: 5 }).start();
  b.run(6 * HOUR);
  const seqBefore = b.device.state.seq;
  b.device.reboot('update');
  b.run(6 * HOUR);
  const totals = b.of('frame').map((f) => f.water_total_l);
  assert.ok(totals.every((x, i) => i === 0 || x >= totals[i - 1]!));
  assert.ok(totals.at(-1)! > 0);
  const afterReboot = b.events('reboot').at(-1)!;
  assert.equal(afterReboot.code, 'update');
  assert.ok(afterReboot.seq > seqBefore);
});

test('потеря LTE на 2 ч: тишина, затем hello и досылка буфера по порядку seq, без переполнения', () => {
  const b = new Bench().start();
  b.run(10 * MIN);
  b.device.lteLoss(2 * HOUR);
  b.clear();
  b.run(2 * HOUR - MIN);
  assert.equal(b.got.length, 0);
  b.run(2 * MIN);
  assert.equal(b.got[0]!.msg.mt, 'hello');
  const flushed = b.got.slice(1).filter((d) => d.msg.mt === 'frame').map((d) => (d.msg.body as { seq: number }).seq);
  assert.ok(flushed.length >= 23, `досланных кадров ${flushed.length}`);
  assert.deepEqual(flushed, [...flushed].sort((x, y) => x - y));
  assert.equal(b.events('buffer_overflow').length, 0);
});

test('обрыв дольше 72 ч: самые старые кадры удалены, buffer_overflow с числом потерянных', () => {
  const b = new Bench().start();
  b.device.lteLoss(80 * HOUR);
  b.run(80 * HOUR + 2 * MIN);
  const o = b.events('buffer_overflow');
  assert.equal(o.length, 1);
  const lost = o[0]!.data!['frames_lost'] as number;
  assert.ok(lost >= 95 && lost <= 97, `потеряно ${lost}`); // 80 ч × 12 − 864
  const flushed = b.of('frame').filter((f) => Date.parse(f.ts) < b.clock.now() - 2 * MIN);
  assert.equal(flushed.length, 864);
  // Удалены самые старые: досланные кадры — последние 864, без дыр по времени.
  const first = Date.parse(flushed[0]!.ts);
  assert.ok(first >= T0 + (lost - 1) * 5 * MIN, `первый досланный кадр ${flushed[0]!.ts}`);
  const gaps = flushed.slice(1).map((f, i) => Date.parse(f.ts) - Date.parse(flushed[i]!.ts));
  assert.ok(gaps.every((g) => g === 5 * MIN));
});

test('нет CO2 — B3 поднимается и снимается; co2_ok в кадре', () => {
  const b = new Bench().start();
  b.device.faults.co2Out = true;
  b.run(6 * MIN);
  assert.equal(b.events('error_raised').filter((e) => e.code === 'B3').length, 1);
  assert.equal(b.of('frame').at(-1)!.co2_ok, false);
  b.device.faults.co2Out = false;
  b.run(2 * MIN);
  assert.equal(b.events('error_cleared').filter((e) => e.code === 'B3').length, 1);
});

test('отказ охлаждения: охлаждение включено, а температура уходит выше уставки', () => {
  const b = new Bench().start();
  b.run(3 * HOUR);
  const ok = b.of('frame').at(-1)!;
  assert.ok(ok.t_cold! <= ok.t_cold_set! + 2, `норма: ${ok.t_cold} при уставке ${ok.t_cold_set}`);
  b.device.faults.cooler = true;
  b.run(3 * HOUR);
  const bad = b.of('frame').at(-1)!;
  assert.equal(bad.cool_on, true);
  assert.ok(bad.t_cold! > bad.t_cold_set! + 5, `отказ: ${bad.t_cold} при уставке ${bad.t_cold_set}`);
});

test('бутыль: снятие и установка с литрами с прошлой замены (модель с верхней бутылью)', () => {
  const b = new Bench({ usage: 20 }).start();
  b.run(12 * HOUR);
  const removed = b.events('bottle_removed');
  const installed = b.events('bottle_installed');
  assert.ok(removed.length >= 1);
  assert.ok((installed[0]!.data!['liters_since_last'] as number) >= 18.9);
});

test('команда офлайн-устройству ждёт подключения в хабе; просроченную устройство отклоняет', () => {
  const b = new Bench().start();
  b.device.lteLoss(5 * MIN);
  const id = b.send('POST', 'otaallowed', '1'); // срок 30 с — истечёт до подключения
  b.run(6 * MIN);
  assert.equal(b.acks(id).length, 1);
  assert.equal(b.results(id)[0]!.message, 'deadline passed');
});

test('переполнение буфера событий: старейшие удалены, events_lost верный', () => {
  const b = new Bench().start();
  b.device.lteLoss(3 * HOUR);
  b.run(MIN);
  for (let i = 0; i < 1100; i++) b.device.localScheduleEdit(i % 2 ? 'w1,08:00,18:00;' : 'w1,09:00,18:00;');
  const last = b.device.state.seq;
  b.run(3 * HOUR);
  const o = b.events('buffer_overflow');
  assert.equal(o.length, 1);
  assert.equal(o[0]!.data!['events_lost'], 100);
  const flushed = b.events('schedule_applied').map((e) => e.seq);
  // Удалены ровно 100 самых старых: дошли последние 1000 созданных.
  assert.deepEqual(flushed, Array.from({ length: 1000 }, (_, i) => last - 999 + i));
});

test('20 обрывов питания подряд: счётчики и seq целы', () => {
  const b = new Bench({ usage: 10 }).start();
  b.run(HOUR);
  let total = b.device.state.waterTotal, seq = b.device.state.seq;
  for (let i = 0; i < 20; i++) {
    b.device.powerOff();
    b.run(MIN);
    b.device.powerOn('power');
    b.run(30 * MIN);
    assert.ok(b.device.state.waterTotal >= total);
    assert.ok(b.device.state.seq > seq);
    total = b.device.state.waterTotal; seq = b.device.state.seq;
  }
  assert.equal(b.events('reboot').length, 21);
});

test('перезагрузка во время потери LTE: связь восстанавливается, когда сеть вернулась', () => {
  const b = new Bench().start();
  b.device.lteLoss(HOUR);
  b.run(10 * MIN);
  b.device.reboot('watchdog');
  b.run(30 * MIN);
  assert.equal(b.device.connected, false);
  b.run(25 * MIN);
  assert.equal(b.device.connected, true);
});

test('обрыв между отправкой и подтверждением, быстрое переподключение: ничего не потеряно, буфер пуст, ложного переполнения нет', () => {
  const b = new Bench({ reconnectMs: [1, 1] }).start();
  b.device.lteLoss(HOUR);
  b.run(MIN);
  for (let i = 0; i < 1000; i++) b.device.localScheduleEdit(i % 2 ? 'w1,08:00,18:00;' : 'w1,09:00,18:00;');
  const created = b.device.state.seq;
  b.run(HOUR - MIN + 10); // сеть вернулась 10 мс назад: досылка 1000 событий ушла, подтверждение — через 50 мс
  assert.ok(b.device.state.inflight >= 1000); // события и кадры часа без связи
  b.device.lteLoss(1); // обрыв до подтверждения; переподключение через миллисекунды — повторная досылка
  b.run(5 * MIN);
  const seqs = new Set(b.events('schedule_applied').map((e) => e.seq));
  for (let q = created - 999; q <= created; q++) assert.ok(seqs.has(q), `событие seq ${q} не дошло`);
  assert.equal(b.device.state.inflight, 0);
  assert.equal(b.device.state.bufferedEvents, 0);
  b.device.lteLoss(10 * MIN);
  b.run(MIN);
  b.device.localScheduleEdit('w1,07:00,18:00;');
  b.run(15 * MIN);
  assert.equal(b.events('buffer_overflow').length, 0, 'ложное переполнение');
});

test('GET all: обрыв до подтверждения результата и кадра — оба досланы после переподключения', () => {
  const b = new Bench({ reconnectMs: [1, 1] }).start();
  b.run(10 * MIN);
  const id = b.send('GET', 'all');
  b.run(90); // C2D дошла через 50 мс, исполнение через 20 мс — результат и кадр отправлены, подтверждения ещё нет
  assert.equal(b.results(id).length, 0);
  b.device.lteLoss(1);
  b.run(MIN);
  assert.equal(b.results(id).length, 1);
  assert.equal(b.of('frame').filter((f) => f.cmd_id === id).length, 1);
  assert.equal(b.device.state.inflight, 0);
});

test('две команды нагрева подряд при медленном контроллере: итог — по последней', () => {
  const b = new Bench({ uartMs: [1500, 1500] }).start();
  b.run(2 * MIN);
  b.send('POST', 'hottank', '0');
  b.run(200);
  const second = b.send('POST', 'hottank', '1');
  b.run(5000);
  assert.equal(b.device.state.ctrl.heat, true);
  assert.equal(b.device.state.heatEnabled, true);
  const c = b.events('controller_confirmed').find((e) => e.data!['cmd_id'] === second)!;
  assert.equal(c.data!['heat_on'], true);
});

test('подтверждение — по фактическому AT+LOAD: контроллер замолчал после отправки — not_confirmed', () => {
  const b = new Bench({ uartMs: [1000, 1000] }).start();
  b.run(2 * MIN);
  const id = b.send('POST', 'coldtank', '0');
  b.run(500); // AT+PUSH ушёл, ответа ещё нет
  b.device.faults.controllerSilent = true;
  b.run(31_000);
  assert.equal(b.events('controller_confirmed').filter((e) => e.data!['cmd_id'] === id).length, 0);
  assert.equal(b.events('controller_not_confirmed').filter((e) => e.data!['cmd_id'] === id).length, 1);
});

test('подтверждение — по фактическому AT+LOAD: контроллер ожил до срока — confirmed', () => {
  const b = new Bench({ uartMs: [1000, 1000] }).start();
  b.run(2 * MIN + 30_000);
  b.device.faults.controllerSilent = true;
  const id = b.send('POST', 'coldtank', '0');
  b.run(2000);
  b.device.faults.controllerSilent = false; // следующая строка AT+LOAD — в минутном опросе, до срока
  b.run(30_000);
  assert.equal(b.events('controller_confirmed').filter((e) => e.data!['cmd_id'] === id).length, 1);
  assert.equal(b.events('controller_not_confirmed').filter((e) => e.data!['cmd_id'] === id).length, 0);
});

test('filterreset сбрасывает и простой: B2 снимается', () => {
  const b = new Bench({ usage: 0 }).start();
  b.run(23 * 24 * HOUR);
  assert.equal(b.events('error_raised').filter((e) => e.code === 'B2').length, 1);
  b.send('POST', 'filterreset', '1');
  b.run(2 * MIN);
  assert.equal(b.events('error_cleared').filter((e) => e.code === 'B2').length, 1);
  assert.equal(b.of('frame').at(-1)!.idle_days, 0);
});

test('B1 — по счётчику литров, а не по округлённому проценту', () => {
  const b = new Bench({ filterUsedL: 24_900, usage: 0 }).start();
  b.run(10 * MIN);
  assert.equal(b.of('frame').at(-1)!.filter_left_pct, 0); // в кадре — округление вниз
  assert.equal(b.events('error_raised').filter((e) => e.code === 'B1').length, 0);
});

test('часовой пояс вне IANA (псевдоним ICU) — invalid value', () => {
  const b = new Bench().start();
  const deadline_at = new Date(b.clock.now() + 30_000).toISOString();
  b.send('POST', 'timezone', 'ACT', { id: 'tz1', raw: { v: 0, cmd_id: 'tz1', deadline_at, op: 'POST', param: 'timezone', value: 'ACT' } });
  b.run(1000);
  assert.equal(b.results('tz1')[0]!.message, 'invalid value');
  assert.equal(b.device.state.timezone, 'Europe/Riga');
});

test('перезагрузка до ответа контроллера: ожидание переживает её и кончается ровно одним событием', () => {
  const b = new Bench({ uartMs: [1000, 1000] }).start();
  b.run(2 * MIN);
  const id = b.send('POST', 'hottank', '0');
  b.run(500);
  b.device.reboot('watchdog');
  b.run(2 * MIN);
  const n = b.of('event').filter((e) => e.data?.['cmd_id'] === id);
  assert.equal(n.length, 1, JSON.stringify(n));
  assert.match(n[0]!.type, /^controller_(not_)?confirmed$/);
});

test('AT+LOAD после срока — не подтверждение: controller_not_confirmed', () => {
  const b = new Bench({ uartMs: [40_000, 40_000] }).start();
  b.run(3 * MIN);
  const id = b.send('POST', 'coldtank', '0');
  b.run(MIN);
  assert.equal(b.events('controller_confirmed').filter((e) => e.data!['cmd_id'] === id).length, 0);
  assert.equal(b.events('controller_not_confirmed').filter((e) => e.data!['cmd_id'] === id).length, 1);
});

test('AT+LOAD через 0,5 мс после срока, раньше таймера срока — всё равно не подтверждение', () => {
  // Команда приходит через 50 мс (хаб), исполняется через 20 мс; срок — отправка + 30 с.
  const b = new Bench({ uartMs: [30_000 - 70 + 0.5, 30_000 - 70 + 0.5] }).start();
  b.run(3 * MIN);
  const id = b.send('POST', 'coldtank', '0');
  b.run(MIN);
  assert.equal(b.events('controller_confirmed').filter((e) => e.data!['cmd_id'] === id).length, 0);
  assert.equal(b.events('controller_not_confirmed').filter((e) => e.data!['cmd_id'] === id).length, 1);
});
