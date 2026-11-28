// Общее для устройств: колонки реестра, представление Device / DeviceListItem (контракт), состояние от телеметрии.
import { Problem } from '../http/problem.ts';
import { liveFilterPasses, type LiveFilter, type LiveState, type TelemetrySource } from '../telemetry.ts';

export type Q = Record<string, string | number | boolean | undefined>;
const bad = (path: string, message: string) => new Problem(422, message, { errors: [{ path, message }] });

export const DEVICE_COLS = `d.id, d.device_id, d.serial, d.imei, d.water_source, d.variant, d.carbonated, d.sku, d.hw, d.lifecycle, d.ownership,
  d.client_id, d.address_id, d.esim_profile_id, d.description, d.blocked_at, d.created_at`;
export const DEVICE_LIST_COLS = `${DEVICE_COLS}, cl.name as client_name, a.address as address_text, a.floor, a.place, a.region, a.lat, a.lng`;
export const DEVICE_LIST_FROM = `app.device d
  left join app.client cl on cl.id = d.client_id and cl.deleted_at is null
  left join app.address a on a.id = d.address_id and a.deleted_at is null`;

type Row = Record<string, any>;

/** Device по контракту: реестр (app) + состояние от дорожки «Устройство». */
export function deviceOut(r: Row, live: LiveState) {
  return {
    id: r.id, device_id: r.device_id, serial: r.serial, imei: r.imei,
    model: { water_source: r.water_source, variant: r.variant, carbonated: r.carbonated, sku: r.sku },
    fw: live.fw, hw: r.hw, cert_thumbprint: null, // отпечаток ведёт provisioning (CERT)
    lifecycle: r.lifecycle, state: live.state, ownership: r.ownership, online: live.online,
    last_seen_at: live.last_seen_at, offline_since: live.offline_since, blocked: r.blocked_at !== null,
    client_id: r.client_id, address_id: r.address_id, esim_profile_id: r.esim_profile_id, description: r.description,
    created_at: r.created_at.toISOString(),
  };
}

export function listItemOut(r: Row, live: LiveState) {
  return {
    ...deviceOut(r, live),
    client_name: r.client_name ?? null, address: r.address_text ?? null, floor: r.floor ?? null, place: r.place ?? null,
    alerts_open: live.alerts_open, filter_left_pct: live.filter_left_pct, liters_period: null,
  };
}

export async function deviceListItems(src: TelemetrySource, rows: Row[]) {
  const live = await src.states(rows.map((r) => r.id));
  return rows.map((r) => listItemOut(r, live.get(r.id)!));
}

/** Сортировка списка: поле → выражение; курсор — значение поля и id. */
export const SORTS: Record<string, { expr: string; type: 'text' | 'timestamptz' }> = {
  created_at: { expr: 'd.created_at', type: 'timestamptz' },
  serial: { expr: 'd.serial', type: 'text' },
  device_id: { expr: 'd.device_id', type: 'text' },
  client_name: { expr: "coalesce(cl.name, '')", type: 'text' },
};

/** sort=[-]поле → поле, направление, выражение; неизвестное поле (и свойства прототипа) — 422. */
export function parseSort(q: Q) {
  const sortArg = String(q['sort'] ?? '-created_at');
  const desc = sortArg.startsWith('-');
  const field = desc ? sortArg.slice(1) : sortArg;
  if (!Object.hasOwn(SORTS, field)) throw bad('/sort', `сортировка: ${Object.keys(SORTS).join(', ')}`);
  return { field, desc, sort: SORTS[field]! };
}

/** Фильтры реестра — в SQL; фильтры по состоянию от телеметрии — через источник (telemetry.ts). */
export async function deviceFilters(telemetry: TelemetrySource, q: Q, args: unknown[]): Promise<string[] | null> {
  const arg = (v: unknown) => { args.push(v); return `$${args.length}`; };
  const where = ['d.deleted_at is null'];
  const live: LiveFilter = {
    ...(q['state'] ? { state: String(q['state']) } : {}), ...(q['alert_type'] ? { alert_type: String(q['alert_type']) } : {}),
    ...(q['filter_left_max_pct'] !== undefined ? { filter_left_max_pct: Number(q['filter_left_max_pct']) } : {}), ...(q['fw'] ? { fw: String(q['fw']) } : {}),
  };
  if (Object.keys(live).length && !(await liveFilterPasses(telemetry, live))) return null; // никто не подходит
  if (q['q']) {
    const p = arg(`%${q['q']}%`);
    where.push(`(d.device_id ilike ${p} or d.serial ilike ${p} or d.imei ilike ${p} or cl.name ilike ${p} or a.address ilike ${p})`);
  }
  if (q['lifecycle']) where.push(`d.lifecycle = ${arg(q['lifecycle'])}::app.lifecycle`);
  if (q['client_id']) where.push(`d.client_id = ${arg(q['client_id'])}::uuid`);
  if (q['region']) where.push(`a.region = ${arg(q['region'])}`);
  if (q['ownership']) where.push(`d.ownership = ${arg(q['ownership'])}::app.ownership`);
  if (q['model']) {
    const p = arg(q['model']);
    where.push(`(d.sku = ${p} or d.water_source::text = ${p})`);
  }
  if (q['esim_status']) where.push(`exists (select 1 from app.esim_profile e where e.id = d.esim_profile_id and e.deleted_at is null and e.status = ${arg(q['esim_status'])}::app.esim_status)`);
  return where;
}

