// Хаб в памяти: для тестов и ускоренных прогонов. Повторяет поведение IoT Hub, важное для протокола:
// команды (C2D) офлайн-устройству хранятся до TTL и доставляются после подключения.
import type { Clock } from '../clock.ts';
import type { DeviceLink, Outgoing } from '../messages.ts';

export interface Delivered { deviceId: string; at: number; msg: Outgoing }

export class MemoryHub {
  readonly #clock: Clock;
  readonly #latencyMs: number;
  readonly #ttlMs: number;
  readonly #links = new Map<string, MemoryLink>();
  readonly #pending = new Map<string, { raw: string; expires: number }[]>();
  #listeners: ((d: Delivered) => void)[] = [];

  constructor(clock: Clock, opts: { latencyMs?: number; c2dTtlMs?: number } = {}) {
    this.#clock = clock;
    this.#latencyMs = opts.latencyMs ?? 50;
    this.#ttlMs = opts.c2dTtlMs ?? 60 * 60_000;
  }

  link(deviceId: string): DeviceLink {
    const l = new MemoryLink(this, deviceId);
    this.#links.set(deviceId, l);
    return l;
  }

  /** Платформа: сообщения устройств (встроенная точка messages/events). */
  onMessage(fn: (d: Delivered) => void): void { this.#listeners.push(fn); }

  /** Платформа: команда устройству (C2D). Офлайн — ждёт подключения до TTL. */
  sendCommand(deviceId: string, body: object | string): void {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const l = this.#links.get(deviceId);
    if (l?.connected) { this.#deliverC2d(l, raw); return; }
    const q = this.#pending.get(deviceId) ?? [];
    q.push({ raw, expires: this.#clock.now() + this.#ttlMs });
    this.#pending.set(deviceId, q);
  }

  isConnected(deviceId: string): boolean { return this.#links.get(deviceId)?.connected ?? false; }

  /** @internal */
  connected(l: MemoryLink): void {
    const q = this.#pending.get(l.deviceId) ?? [];
    this.#pending.delete(l.deviceId);
    const now = this.#clock.now();
    for (const p of q) if (p.expires > now) this.#deliverC2d(l, p.raw);
  }

  /** @internal */
  d2c(l: MemoryLink, msg: Outgoing, done?: (ok: boolean) => void): void {
    const copy = JSON.parse(JSON.stringify(msg)) as Outgoing;
    const session = l.session;
    this.#clock.setTimeout(() => {
      // Обрыв до подтверждения — сообщение не дошло, устройство повторит.
      if (!l.connected || l.session !== session) { done?.(false); return; }
      const d = { deviceId: l.deviceId, at: this.#clock.now(), msg: copy };
      for (const fn of this.#listeners) fn(d);
      done?.(true);
    }, this.#latencyMs);
  }

  #deliverC2d(l: MemoryLink, raw: string): void {
    this.#clock.setTimeout(() => { if (l.connected) l.command(raw); }, this.#latencyMs);
  }
}

class MemoryLink implements DeviceLink {
  readonly deviceId: string;
  readonly #hub: MemoryHub;
  #connected = false;
  /** Номер сессии: растёт при каждом подключении. */
  session = 0;
  #onConnect: (() => void)[] = [];
  #onDisconnect: (() => void)[] = [];
  #onCommand: ((raw: string) => void)[] = [];

  constructor(hub: MemoryHub, deviceId: string) { this.#hub = hub; this.deviceId = deviceId; }

  get connected(): boolean { return this.#connected; }
  connect(): void {
    if (this.#connected) return;
    this.#connected = true;
    this.session++;
    for (const fn of this.#onConnect) fn();
    this.#hub.connected(this);
  }
  disconnect(): void {
    if (!this.#connected) return;
    this.#connected = false;
    for (const fn of this.#onDisconnect) fn();
  }
  publish(msg: Outgoing, done?: (ok: boolean) => void): void {
    if (this.#connected) this.#hub.d2c(this, msg, done); else done?.(false);
  }
  onConnect(fn: () => void): void { this.#onConnect.push(fn); }
  onDisconnect(fn: () => void): void { this.#onDisconnect.push(fn); }
  onCommand(fn: (raw: string) => void): void { this.#onCommand.push(fn); }
  /** @internal */
  command(raw: string): void { for (const fn of this.#onCommand) fn(raw); }
}
