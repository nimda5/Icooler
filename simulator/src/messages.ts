// Типы сообщений по контрактам contracts/schemas (ТЗ §7.3). Тип сообщения — свойство IoT Hub `mt`.

export type MessageType = 'frame' | 'event' | 'heartbeat' | 'hello' | 'ack' | 'result';

export interface Model {
  water_source: 'bottle_top' | 'bottle_bottom' | 'mains';
  variant: 'A' | 'S';
  carbonated: boolean;
  build?: string;
}

export interface Frame {
  v: 0; device_id: string; ts: string; seq: number; cmd_id: string | null;
  t_hot: number | null; t_cold: number | null; t_hot_set: number | null; t_cold_set: number | null;
  heat_on: boolean; cool_on: boolean; heat_enabled: boolean; cool_enabled: boolean;
  power_on: boolean; energy_saving: boolean; water_total_l: number; bottle_present: boolean | null;
  uvc_on: boolean; co2_ok: boolean | null;
  filter_left_pct: number; filter_used_l: number; filter_days: number; idle_days: number;
  past_state: 'idle' | 'running' | 'done' | 'error' | null; errors: string[];
  rssi: number; rsrp: number; rsrq: number; sinr: number; operator: string; roaming: boolean;
  fw?: string; hw?: string;
}

export type EventType =
  | 'error_raised' | 'error_cleared' | 'past_started' | 'past_finished' | 'bottle_removed' | 'bottle_installed'
  | 'reboot' | 'buffer_overflow' | 'schedule_applied' | 'controller_confirmed' | 'controller_not_confirmed';

export interface DeviceEvent {
  v: 0; device_id: string; seq: number; ts: string; type: EventType;
  code?: string; data?: Record<string, unknown>;
}

export interface Heartbeat { v: 0; device_id: string; ts: string }

export interface Hello {
  v: 0; device_id: string; ts: string; fw: string; hw: string; model: Model;
  schedule_version: string | null; schedule?: string; timezone?: string; ota_allowed: boolean;
}

export interface Command {
  v: number; cmd_id: string; deadline_at: string; op: 'GET' | 'POST'; param: string; value?: string;
}

export interface Ack { v: 0; cmd_id: string; ack: true }

export interface Result {
  v: 0; cmd_id: string; code: 200 | 400;
  param?: 'schedversion' | 'timezone' | 'otaallowed'; value?: string; message?: string;
  applied?: 'pushed' | 'flag_only'; checks?: Record<string, 'ok' | 'fail'>;
}

export type Outgoing =
  | { mt: 'frame'; body: Frame } | { mt: 'event'; body: DeviceEvent } | { mt: 'heartbeat'; body: Heartbeat }
  | { mt: 'hello'; body: Hello } | { mt: 'ack'; body: Ack } | { mt: 'result'; body: Result };

/** Канал устройства к хабу. Команды приходят строкой (тело C2D-сообщения). */
export interface DeviceLink {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  /** done(true) — доставка подтверждена (PUBACK для QoS 1), done(false) — не доставлено. */
  publish(msg: Outgoing, done?: (ok: boolean) => void): void;
  onConnect(fn: () => void): void;
  onDisconnect(fn: () => void): void;
  onCommand(fn: (raw: string) => void): void;
}

/** ISO-8601 UTC без миллисекунд — для версий local:<время>. */
export const isoSeconds = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
