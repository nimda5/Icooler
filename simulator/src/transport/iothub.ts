// Канал к Azure IoT Hub по MQTT 3.1.1 поверх TLS (порт 8883).
// Темы: D2C — devices/{id}/messages/events/{свойства}, C2D — devices/{id}/messages/devicebound/#.
// Тип сообщения — свойство mt (contracts/README.md, решение 1). Подключение — X.509 (FW-3);
// SAS — только для разработки на своём хабе, пока нет DPS и сертификатов (в ТЗ устройства — только X.509).
import mqtt, { type MqttClient } from 'mqtt';
import { createHmac } from 'node:crypto';
import type { DeviceLink, Outgoing } from '../messages.ts';

export type IotHubAuth =
  | { kind: 'x509'; cert: string | Buffer; key: string | Buffer }
  | { kind: 'sas'; key: string; ttlSec?: number }
  | { kind: 'none' }; // локальный брокер для тестов

export interface IotHubOptions {
  /** Имя хоста хаба, например venden-iot-neu.azure-devices.net. */
  host: string;
  deviceId: string;
  auth: IotHubAuth;
  /** Переопределение адреса (локальный брокер в тестах), например mqtt://127.0.0.1:1883. */
  url?: string;
  log?: (msg: string) => void;
}

export const API_VERSION = '2021-04-12';

export function d2cTopic(deviceId: string, mt: string): string {
  return `devices/${encodeURIComponent(deviceId)}/messages/events/mt=${mt}&%24.ct=application%2Fjson&%24.ce=utf-8`;
}

export function c2dFilter(deviceId: string): string {
  return `devices/${encodeURIComponent(deviceId)}/messages/devicebound/#`;
}

/** SAS-токен устройства (только для разработки). */
export function sasToken(host: string, deviceId: string, key: string, ttlSec: number, nowSec: number): string {
  const sr = encodeURIComponent(`${host}/devices/${encodeURIComponent(deviceId)}`);
  const se = nowSec + ttlSec;
  const sig = createHmac('sha256', Buffer.from(key, 'base64')).update(`${sr}\n${se}`).digest('base64');
  return `SharedAccessSignature sr=${sr}&sig=${encodeURIComponent(sig)}&se=${se}`;
}

export class IotHubLink implements DeviceLink {
  readonly #o: IotHubOptions;
  #client: MqttClient | null = null;
  #connected = false;
  #onConnect: (() => void)[] = [];
  #onDisconnect: (() => void)[] = [];
  #onCommand: ((raw: string) => void)[] = [];

  constructor(o: IotHubOptions) { this.#o = o; }

  get connected(): boolean { return this.#connected; }

  connect(): void {
    if (this.#client) return;
    const { host, deviceId, auth } = this.#o;
    const tls = auth.kind === 'x509' ? { cert: auth.cert, key: auth.key } : {};
    const password = auth.kind === 'sas'
      ? sasToken(host, deviceId, auth.key, auth.ttlSec ?? 3600, Math.floor(Date.now() / 1000))
      : undefined;
    const client = mqtt.connect(this.#o.url ?? `mqtts://${host}:8883`, {
      clientId: deviceId,
      username: `${host}/${deviceId}/?api-version=${API_VERSION}`,
      ...(password ? { password } : {}),
      ...tls,
      protocolVersion: 4,
      keepalive: 240,
      clean: false,
      reconnectPeriod: 0, // переподключением управляет устройство
      connectTimeout: 30_000,
    });
    this.#client = client;
    client.on('connect', () => {
      client.subscribe(c2dFilter(deviceId), { qos: 1 }, (err) => {
        if (err) { this.#o.log?.(`${deviceId}: подписка C2D: ${err.message}`); client.end(true); return; }
        this.#connected = true;
        for (const fn of this.#onConnect) fn();
      });
    });
    client.on('message', (_topic, payload) => { for (const fn of this.#onCommand) fn(payload.toString('utf8')); });
    client.on('error', (err) => this.#o.log?.(`${deviceId}: ${err.message}`));
    client.on('close', () => this.#closed());
  }

  disconnect(): void {
    const c = this.#client;
    if (!c) return;
    c.end(true);
    this.#closed();
  }

  publish(msg: Outgoing, done?: (ok: boolean) => void): void {
    if (!this.#connected || !this.#client) { done?.(false); return; }
    this.#client.publish(d2cTopic(this.#o.deviceId, msg.mt), JSON.stringify(msg.body), { qos: 1 }, (err) => done?.(!err));
  }

  onConnect(fn: () => void): void { this.#onConnect.push(fn); }
  onDisconnect(fn: () => void): void { this.#onDisconnect.push(fn); }
  onCommand(fn: (raw: string) => void): void { this.#onCommand.push(fn); }

  #closed(): void {
    const was = this.#connected || this.#client !== null;
    this.#client?.removeAllListeners().on('error', () => {});
    this.#client = null;
    if (this.#connected) {
      this.#connected = false;
      for (const fn of this.#onDisconnect) fn();
    } else if (was) {
      for (const fn of this.#onDisconnect) fn(); // не удалось подключиться — устройство повторит
    }
  }
}
