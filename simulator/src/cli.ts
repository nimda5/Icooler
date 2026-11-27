// Запуск: node src/cli.ts --help
import { parseArgs } from 'node:util';
import { createWriteStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VirtualClock, RealClock } from './clock.ts';
import { createFleet, SCENARIOS, type Scenario } from './fleet.ts';
import { MemoryHub } from './transport/memory.ts';
import { IotHubLink, type IotHubAuth } from './transport/iothub.ts';

const HELP = `Симулятор кулеров iCooler (ТЗ Stage 1 §7.3, SIM).

  --devices N            число устройств (по умолчанию 10)
  --duration 2h          длительность: 30m, 2h, 1d (по умолчанию 1h)
  --transport memory     memory — хаб в памяти, виртуальное время, прогон с максимальной скоростью
                         iothub — Azure IoT Hub по MQTT/TLS, реальное время
                         mqtt   — локальный брокер MQTT (--url), реальное время
  --host H               хост хаба, например venden-iot-neu.azure-devices.net
  --auth x509|sas        x509: --certs <папка> с <device_id>.pem и <device_id>.key;
                         sas (только для разработки): --keys <файл JSON {device_id: ключ}>
  --url U                адрес брокера для --transport mqtt (mqtt://127.0.0.1:1883)
  --prefix sim           префикс device_id (sim-0000, sim-0001, …)
  --scenario s=доля      сценарий для доли устройств, можно несколько: --scenario lte_loss=0.1
                         ${SCENARIOS.join(', ')}
  --schedule S           расписание для половины устройств (с энергосбережением)
  --out file.jsonl       memory: записать все сообщения устройств
  --seed N               зерно генератора
`;

const { values: a } = parseArgs({
  options: {
    devices: { type: 'string', default: '10' }, duration: { type: 'string', default: '1h' },
    transport: { type: 'string', default: 'memory' }, host: { type: 'string' }, auth: { type: 'string' },
    certs: { type: 'string' }, keys: { type: 'string' }, url: { type: 'string' }, prefix: { type: 'string', default: 'sim' },
    scenario: { type: 'string', multiple: true, default: [] }, schedule: { type: 'string' }, out: { type: 'string' },
    seed: { type: 'string', default: '1' }, help: { type: 'boolean', default: false },
  },
});
if (a.help) { process.stdout.write(HELP); process.exit(0); }

function duration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(s);
  if (!m) throw new Error(`длительность «${s}»: нужно 30m, 2h, 1d`);
  return Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

const count = Number(a.devices);
const durationMs = duration(a.duration);
const scenarios: Partial<Record<Scenario, number>> = {};
for (const s of a.scenario) {
  const [name, share] = s.split('=');
  if (!SCENARIOS.includes(name as Scenario)) throw new Error(`неизвестный сценарий «${name}»`);
  scenarios[name as Scenario] = Number(share ?? 1);
}
const common = { count, durationMs, scenarios, prefix: a.prefix, seed: Number(a.seed), ...(a.schedule ? { schedule: a.schedule } : {}) };

if (a.transport === 'memory') {
  const clock = new VirtualClock(Date.now());
  const hub = new MemoryHub(clock);
  const out = a.out ? createWriteStream(a.out) : null;
  const counts: Record<string, number> = {};
  hub.onMessage((d) => {
    counts[d.msg.mt] = (counts[d.msg.mt] ?? 0) + 1;
    out?.write(`${JSON.stringify({ device_id: d.deviceId, at: new Date(d.at).toISOString(), mt: d.msg.mt, body: d.msg.body })}\n`);
  });
  const fleet = createFleet(clock, { ...common, link: (id) => hub.link(id) });
  const t0 = performance.now();
  clock.advanceBy(durationMs);
  const secs = (performance.now() - t0) / 1000;
  const total = Object.values(counts).reduce((x, y) => x + y, 0);
  out?.end();
  console.log(JSON.stringify({ devices: fleet.devices.length, duration: a.duration, messages: total, by_type: counts,
    per_device_per_day: Math.round(total / count / (durationMs / 864e5)), wall_seconds: Math.round(secs * 10) / 10 }, null, 2));
} else if (a.transport === 'iothub' || a.transport === 'mqtt') {
  const host = a.host ?? (a.transport === 'mqtt' ? 'localhost' : undefined);
  if (!host) throw new Error('--host обязателен для iothub');
  const keys = a.keys ? (JSON.parse(readFileSync(a.keys, 'utf8')) as Record<string, string>) : {};
  const auth = (id: string): IotHubAuth => {
    if (a.transport === 'mqtt') return { kind: 'none' };
    if (a.auth === 'x509') {
      if (!a.certs) throw new Error('--certs обязателен для x509');
      return { kind: 'x509', cert: readFileSync(join(a.certs, `${id}.pem`)), key: readFileSync(join(a.certs, `${id}.key`)) };
    }
    if (a.auth === 'sas') {
      const key = keys[id];
      if (!key) throw new Error(`нет ключа для ${id} в ${a.keys}`);
      return { kind: 'sas', key };
    }
    throw new Error('--auth x509 или sas');
  };
  const clock = new RealClock(1);
  const log = (m: string) => console.error(m);
  const fleet = createFleet(clock, {
    ...common, startSpreadMs: Math.min(5 * 60_000, count * 100),
    link: (id) => new IotHubLink({ host, deviceId: id, auth: auth(id), log, ...(a.url ? { url: a.url } : {}) }),
  });
  const report = () => {
    const sent: Record<string, number> = {};
    for (const d of fleet.devices) for (const [k, v] of Object.entries(d.stats.sent)) sent[k] = (sent[k] ?? 0) + v;
    console.error(JSON.stringify({ connected: fleet.devices.filter((d) => d.connected).length, sent }));
  };
  const timer = setInterval(report, 60_000);
  const stop = () => { clearInterval(timer); report(); for (const d of fleet.devices) d.powerOff(); setTimeout(() => process.exit(0), 1000); };
  setTimeout(stop, durationMs);
  process.on('SIGINT', stop);
} else {
  throw new Error(`неизвестный транспорт «${a.transport}»`);
}
