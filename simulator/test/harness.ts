// Стенд для тестов: виртуальные часы, хаб в памяти, одно устройство и «платформа», которая шлёт команды.
import assert from 'node:assert/strict';
import { VirtualClock } from '../src/clock.ts';
import { VirtualDevice, type DeviceConfig } from '../src/device.ts';
import { MemoryHub, type Delivered } from '../src/transport/memory.ts';
import type { Outgoing } from '../src/messages.ts';
import { commandErrors, contractErrors } from './contract.ts';

type Body<M extends Outgoing['mt']> = Extract<Outgoing, { mt: M }>['body'];

export const T0 = Date.parse('2026-12-07T09:00:00Z'); // понедельник, 11:00 в Риге
export const MIN = 60_000;

export class Bench {
  readonly clock = new VirtualClock(T0);
  readonly hub = new MemoryHub(this.clock);
  readonly got: Delivered[] = [];
  readonly device: VirtualDevice;
  #n = 0;

  constructor(cfg: Partial<DeviceConfig> = {}) {
    this.hub.onMessage((d) => {
      const errs = contractErrors(d.msg);
      assert.deepEqual(errs, [], `${d.msg.mt} не по контракту: ${JSON.stringify(d.msg.body)}`);
      this.got.push(d);
    });
    this.device = new VirtualDevice(this.clock, this.hub.link('dev-1'), {
      id: 'dev-1', model: { water_source: 'bottle_top', variant: 'A', carbonated: true }, ...cfg,
    });
  }

  /** Включить и дождаться подключения. */
  start(): this { this.device.powerOn(); this.run(10_000); return this; }
  run(ms: number): void { this.clock.advanceBy(ms); }

  /** Отправить команду по контракту; вернуть её cmd_id. */
  send(op: 'GET' | 'POST', param: string, value?: string, opts: { deadlineMs?: number; id?: string; raw?: object } = {}): string {
    const cmd_id = opts.id ?? `c${++this.#n}`;
    const body = opts.raw ?? {
      v: 0, cmd_id, deadline_at: new Date(this.clock.now() + (opts.deadlineMs ?? 30_000)).toISOString(), op, param,
      ...(value !== undefined ? { value } : {}),
    };
    if (!opts.raw) assert.deepEqual(commandErrors(body), [], `тестовая команда не по контракту: ${JSON.stringify(body)}`);
    this.hub.sendCommand('dev-1', body);
    return cmd_id;
  }

  of<M extends Outgoing['mt']>(mt: M): Body<M>[] {
    return this.got.filter((d) => d.msg.mt === mt).map((d) => d.msg.body as unknown as Body<M>);
  }
  results(id: string) { return this.of('result').filter((r) => r.cmd_id === id); }
  acks(id: string) { return this.of('ack').filter((r) => r.cmd_id === id); }
  events(type: string) { return this.of('event').filter((e) => e.type === type); }
  clear(): void { this.got.length = 0; }
}
