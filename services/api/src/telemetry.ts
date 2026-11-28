// Состояние устройства от дорожки «Устройство» (§6.3): online, тех. состояние, last seen, прошивка, ресурс фильтра,
// открытые алерты. Пишет его ingest (Redis, схема telemetry) — пока его нет, источник честно отвечает
// «ни разу не выходило на связь». Фильтры списка и карты считаются от этих же значений, чтобы ответ был согласован.
export interface LiveState {
  online: boolean;
  state: 'operational' | 'warning' | 'fault' | 'offline';
  last_seen_at: string | null;
  offline_since: string | null;
  fw: string | null;
  filter_left_pct: number | null;
  alerts_open: number;
  alert_types: string[];
}

export interface TelemetrySource {
  states(deviceIds: string[]): Promise<Map<string, LiveState>>;
}

const NEVER_SEEN: LiveState = {
  online: false, state: 'offline', last_seen_at: null, offline_since: null, fw: null, filter_left_pct: null, alerts_open: 0, alert_types: [],
};

/** До ingest: ни одно устройство ещё не выходило на связь. */
export class NoTelemetry implements TelemetrySource {
  async states(ids: string[]): Promise<Map<string, LiveState>> {
    return new Map(ids.map((id) => [id, NEVER_SEEN]));
  }
}

export interface LiveFilter { state?: string; alert_type?: string; filter_left_max_pct?: number; fw?: string }

/** Подходит ли состояние под фильтры, зависящие от телеметрии. */
export function matchesLive(s: LiveState, f: LiveFilter): boolean {
  if (f.state && s.state !== f.state) return false;
  if (f.alert_type && !s.alert_types.includes(f.alert_type)) return false;
  if (f.filter_left_max_pct !== undefined && (s.filter_left_pct === null || s.filter_left_pct > f.filter_left_max_pct)) return false;
  if (f.fw && s.fw !== f.fw) return false;
  return true;
}

/**
 * Можно ли вообще чему-то подойти при нынешнем источнике: пока у всех устройств одно и то же «не выходило на связь»,
 * фильтр либо пропускает всех, либо никого — это проверяется на образце без обхода списка (пагинация остаётся в SQL).
 * С появлением ingest фильтры переедут в SQL по данным telemetry.
 */
export async function liveFilterPasses(src: TelemetrySource, f: LiveFilter): Promise<boolean> {
  if (!(src instanceof NoTelemetry)) throw new Error('фильтры по телеметрии для живого источника — в SQL (ещё не сделано)');
  const sample = (await src.states(['_'])).get('_')!;
  return matchesLive(sample, f);
}

export const TELEMETRY = Symbol('TELEMETRY');
