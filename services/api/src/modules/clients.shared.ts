// Представления клиента и адреса по контракту (Client, Address) — общие для клиентов и устройств.
type Row = Record<string, any>;

export const CLIENT_COLS = `c.id, c.type, c.name, c.reg_number, c.legal_address, c.created_at`;
export const clientOut = (r: Row) => ({
  id: r.id, type: r.type, name: r.name, reg_number: r.reg_number, legal_address: r.legal_address, created_at: r.created_at.toISOString(),
});
export const ADDRESS_COLS = `a.id, a.client_id, a.address, a.region, a.lat, a.lng, a.coords_source, a.floor, a.place, a.access_note`;
/** coords_source — только если координаты есть (enum без null в контракте). */
export const addressOut = (r: Row) => ({
  id: r.id, client_id: r.client_id, address: r.address, region: r.region, lat: r.lat, lng: r.lng,
  ...(r.coords_source ? { coords_source: r.coords_source } : {}), floor: r.floor, place: r.place, access_note: r.access_note,
});
