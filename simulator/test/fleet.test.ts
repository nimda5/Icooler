// Парк со всеми сценариями SIM за двое суток: каждое сообщение — по контракту, сценарии дают ожидаемые следы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualClock } from '../src/clock.ts';
import { createFleet, SCENARIOS } from '../src/fleet.ts';
import { MemoryHub } from '../src/transport/memory.ts';
import { contractErrors } from './contract.ts';
import { T0 } from './harness.ts';

const DAY = 864e5;

test('50 устройств, все сценарии, 2 суток: все сообщения по контракту', () => {
  const clock = new VirtualClock(T0);
  const hub = new MemoryHub(clock);
  const bad: string[] = [];
  const types = new Map<string, number>();
  const events = new Map<string, number>();
  hub.onMessage((d) => {
    const errs = contractErrors(d.msg);
    if (errs.length && bad.length < 5) bad.push(`${d.msg.mt}: ${errs.join('; ')} ${JSON.stringify(d.msg.body)}`);
    types.set(d.msg.mt, (types.get(d.msg.mt) ?? 0) + 1);
    if (d.msg.mt === 'event') events.set(d.msg.body.type, (events.get(d.msg.body.type) ?? 0) + 1);
  });
  const scenarios = Object.fromEntries(SCENARIOS.map((s) => [s, 0.25]));
  const fleet = createFleet(clock, {
    count: 50, durationMs: 2 * DAY, scenarios, seed: 7, schedule: 'w1,08:00,18:00;w2,08:00,18:00;w3,08:00,18:00;',
    link: (id) => hub.link(id),
  });
  clock.advanceBy(2 * DAY);
  assert.deepEqual(bad, []);
  for (const mt of ['hello', 'frame', 'event', 'heartbeat']) assert.ok(types.get(mt), `нет сообщений ${mt}`);
  for (const e of ['reboot', 'schedule_applied', 'error_raised', 'error_cleared', 'bottle_removed', 'bottle_installed', 'buffer_overflow']) {
    if (e === 'buffer_overflow') continue; // 2 ч обрыва не переполняют буфер — переполнение проверено в device.test
    assert.ok(events.get(e), `нет события ${e}`);
  }
  // Каждое устройство дало кадры почти каждые 5 минут (кроме офлайна): ≥ 80 % от 576 кадров за 2 суток.
  for (const d of fleet.devices) assert.ok((d.stats.sent['frame'] ?? 0) >= 460, `${d.id}: кадров ${d.stats.sent['frame']}`);
});

test('нагрузка: 2 000 устройств, 1 ч виртуального времени', () => {
  const clock = new VirtualClock(T0);
  const hub = new MemoryHub(clock);
  let n = 0;
  hub.onMessage(() => { n++; });
  createFleet(clock, { count: 2000, durationMs: 3600e3, link: (id) => hub.link(id) });
  const t = performance.now();
  clock.advanceBy(3600e3);
  const wall = performance.now() - t;
  // ≈ 12 кадров + 59 heartbeat + hello + reboot на устройство
  assert.ok(n > 2000 * 65 && n < 2000 * 80, `сообщений ${n}`);
  assert.ok(wall < 20_000, `заняло ${Math.round(wall)} мс`);
});
