// Парк виртуальных устройств и сценарии SIM (ТЗ §4.4): офлайн, отказ охлаждения/нагрева, фильтр, расход,
// потеря LTE с восстановлением, тишина контроллера, нет CO2, расписание изменено на месте, перезагрузка.
import type { Clock } from './clock.ts';
import { VirtualDevice, type DeviceConfig } from './device.ts';
import type { DeviceLink, Model } from './messages.ts';
import { Rng } from './random.ts';

export const SCENARIOS = [
  'offline', 'cooling_failure', 'heating_failure', 'filter', 'consumption', 'lte_loss',
  'controller_silent', 'co2_out', 'local_schedule', 'reboot',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface FleetOptions {
  count: number;
  prefix?: string;
  seed?: number;
  /** Доля устройств на сценарий, 0..1. */
  scenarios?: Partial<Record<Scenario, number>>;
  /** Длительность прогона, мс: в её пределах выбирается момент начала сценария. */
  durationMs: number;
  /** Расписание для части устройств с энергосбережением. */
  schedule?: string;
  link: (deviceId: string) => DeviceLink;
  /** Разнести включение устройств, мс (по умолчанию — до 60 с). */
  startSpreadMs?: number;
}

export function modelFor(rng: Rng): Model {
  const water_source = rng.pick(['bottle_top', 'bottle_bottom', 'mains'] as const);
  const variant = rng.pick(['A', 'S'] as const);
  const src = { bottle_top: 'BOT_UP', bottle_bottom: 'BOT_DOWN', mains: 'PIPE' }[water_source];
  return { water_source, variant, carbonated: rng.chance(0.3), build: `SS_${src}_CH${variant}` };
}

export interface Fleet { devices: VirtualDevice[]; assigned: Map<string, Scenario[]> }

export function createFleet(clock: Clock, o: FleetOptions): Fleet {
  const rng = new Rng(o.seed ?? 1);
  const prefix = o.prefix ?? 'sim';
  const width = String(o.count - 1).length;
  const devices: VirtualDevice[] = [];
  const assigned = new Map<string, Scenario[]>();
  for (let i = 0; i < o.count; i++) {
    const id = `${prefix}-${String(i).padStart(Math.max(4, width), '0')}`;
    const mine = SCENARIOS.filter((s) => rng.chance(o.scenarios?.[s] ?? 0));
    const withSchedule = !!o.schedule && rng.chance(0.5);
    const model = modelFor(rng);
    if (mine.includes('co2_out')) model.carbonated = true; // сценарий имеет смысл только с газированной водой
    const cfg: DeviceConfig = {
      id, model, seed: rng.int(1, 2 ** 31),
      ...(withSchedule ? { schedule: o.schedule!, energySaving: true, scheduleVersion: '1' } : {}),
      ...(mine.includes('filter') ? { filterUsedL: 24_950 } : {}),
      ...(mine.includes('consumption') ? { usage: 8 } : {}),
    };
    const d = new VirtualDevice(clock, o.link(id), cfg);
    devices.push(d);
    assigned.set(id, mine);
    clock.setTimeout(() => d.powerOn('power'), rng.between(0, o.startSpreadMs ?? MIN));
    for (const s of mine) schedule(clock, d, s, rng.between(0.1, 0.6) * o.durationMs);
  }
  return { devices, assigned };
}

function schedule(clock: Clock, d: VirtualDevice, s: Scenario, at: number): void {
  const later = (ms: number, fn: () => void) => clock.setTimeout(fn, ms);
  later(at, () => {
    switch (s) {
      case 'offline': d.powerOff(); later(30 * MIN, () => d.powerOn('power')); break;
      case 'lte_loss': d.lteLoss(2 * HOUR); break;
      case 'cooling_failure': d.faults.cooler = true; break;
      case 'heating_failure': d.faults.heater = true; break;
      case 'controller_silent': d.faults.controllerSilent = true; later(HOUR, () => { d.faults.controllerSilent = false; }); break;
      case 'co2_out': d.faults.co2Out = true; later(2 * HOUR, () => { d.faults.co2Out = false; }); break;
      case 'local_schedule': d.localScheduleEdit('w1,07:00,20:00;w2,07:00,20:00;w3,07:00,20:00;w4,07:00,20:00;w5,07:00,20:00;'); break;
      case 'reboot': d.reboot('watchdog'); break;
      case 'filter': case 'consumption': break; // заданы в конфигурации с начала
    }
  });
}
