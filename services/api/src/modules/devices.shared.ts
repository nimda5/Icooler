// Общее для устройств: колонки реестра, представление Device / DeviceListItem (контракт), состояние от телеметрии.
import type { LiveState, TelemetrySource } from '../telemetry.ts';

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
