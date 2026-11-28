// Клиенты, адреса, контакты (§4.3: V-021…V-023, V-024 — кулеры клиента в карточке). Изменять — Admin и Tech,
// смотреть — плюс Exec и Dispatcher (§7.1). Удаление — логическое; клиент или адрес с устройствами — 409.
import { Body, Controller, Inject, Param, Query } from '@nestjs/common';
import type pg from 'pg';
import { Ctx, Op } from '../http/op.ts';
import { Problem, conflict, notFound } from '../http/problem.ts';
import { GEOCODER, type Geocoder } from '../geocoder.ts';
import { Db } from '../db/db.service.ts';
import type { RequestContext } from '../auth/context.ts';
import { audit } from '../audit.ts';
import { cursorTs, decodeCursor, encodeCursor, UUID } from './accounts.ts';
import { TELEMETRY, type TelemetrySource } from '../telemetry.ts';
import { deviceListItems, DEVICE_LIST_FROM, DEVICE_LIST_COLS } from './devices.shared.ts';
import { ADDRESS_COLS, addressOut, CLIENT_COLS, clientOut } from './clients.shared.ts';

type ClientBody = { type: 'organization' | 'person'; name: string; reg_number?: string | null; legal_address?: string | null };
type AddressBody = {
  address: string; region?: string | null; lat?: number | null; lng?: number | null; coords_source?: 'geocoded' | 'manual';
  floor?: string | null; place?: string | null; access_note?: string | null;
};
type ContactBody = { name: string; phone?: string | null; email?: string | null; role?: string | null; comment?: string | null };

const CONTACT_COLS = `k.id, k.client_id, k.name, k.phone, k.email, k.role, k.comment`;
const contactOut = (r: Record<string, any>) => ({
  id: r.id, client_id: r.client_id, name: r.name, phone: r.phone, email: r.email, role: r.role, comment: r.comment,
});

/** Текст после обрезки пробелов не пустой — иначе 422 (схема проверяет длину до обрезки). */
export function text(v: string, path: string): string {
  const t = v.trim();
  if (!t) throw new Problem(422, 'Пустое значение', { errors: [{ path, message: 'не может быть пустым' }] });
  return t;
}

@Controller()
export class ClientsController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(TELEMETRY) private readonly telemetry: TelemetrySource,
    @Inject(GEOCODER) private readonly geocoder: Geocoder,
  ) {}

  /** Координаты заданы — ручная правка; не заданы — геокодирование (до транзакции: сеть не держит блокировки). */
  async #coords(b: AddressBody) {
    if (b.lat != null && b.lng != null) return { lat: b.lat, lng: b.lng, source: b.coords_source ?? 'manual' };
    const p = await this.geocoder.geocode(b.address.trim());
    return p ? { lat: p.lat, lng: p.lng, source: 'geocoded' as const } : { lat: null, lng: null, source: null };
  }

  async #client(c: pg.PoolClient, id: string, lock = false) {
    if (!UUID.test(id)) throw notFound();
    const r = (await c.query(`select ${CLIENT_COLS} from app.client c where c.id = $1 and c.deleted_at is null ${lock ? 'for no key update' : ''}`, [id])).rows[0];
    if (!r) throw notFound('Нет такого клиента');
    return r;
  }

  async #row(c: pg.PoolClient, table: 'address' | 'contact', id: string, lock = false) {
    if (!UUID.test(id)) throw notFound();
    const cols = table === 'address' ? ADDRESS_COLS : CONTACT_COLS;
    const al = table === 'address' ? 'a' : 'k';
    const r = (await c.query(`select ${cols} from app.${table} ${al} where ${al}.id = $1 and ${al}.deleted_at is null ${lock ? 'for no key update' : ''}`, [id])).rows[0];
    if (!r) throw notFound();
    return r;
  }

  // ---------------------------------------------------------------- клиенты

  @Op('listClients', 200)
  list(@Ctx() ctx: RequestContext, @Query() q: Record<string, string | number | undefined>) {
    const limit = Number(q['limit'] ?? 50);
    const cur = decodeCursor(q['cursor'] as string | undefined);
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const where = ['c.deleted_at is null'];
      const args: unknown[] = [];
      const arg = (v: unknown) => { args.push(v); return `$${args.length}`; };
      if (q['q']) where.push(`(c.name ilike ${arg(`%${q['q']}%`)} or c.reg_number ilike $${args.length})`);
      if (q['region']) where.push(`exists (select 1 from app.address a where a.client_id = c.id and a.deleted_at is null and a.region = ${arg(q['region'])})`);
      if (cur) where.push(`(c.created_at, c.id) < (${arg(cur[0])}::timestamptz, ${arg(cur[1])}::uuid)`);
      const rows = (await c.query(
        `select ${CLIENT_COLS}, ${cursorTs('c.created_at')},
           (select count(*)::int from app.device d where d.client_id = c.id and d.deleted_at is null) as devices_total
         from app.client c where ${where.join(' and ')} order by c.created_at desc, c.id desc limit ${limit + 1}`, args)).rows;
      const page = rows.slice(0, limit);
      // Открытые алерты по устройствам клиента — от дорожки «Устройство» (telemetry.ts).
      const ids = (await c.query(`select client_id, array_agg(id) as ids from app.device where client_id = any($1) and deleted_at is null group by client_id`,
        [page.map((r) => r.id)])).rows;
      const live = await this.telemetry.states(ids.flatMap((r) => r.ids));
      const alerts = new Map(ids.map((r) => [r.client_id, (r.ids as string[]).reduce((n, d) => n + (live.get(d)?.alerts_open ?? 0), 0)]));
      return {
        items: page.map((r) => ({ ...clientOut(r), devices_total: r.devices_total, alerts_open: alerts.get(r.id) ?? 0 })),
        next_cursor: rows.length > limit ? encodeCursor(page.at(-1)!) : null,
      };
    });
  }

  @Op('createClient', 201)
  create(@Ctx() ctx: RequestContext, @Body() b: ClientBody) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const r = (await c.query(`insert into app.client (tenant_id, type, name, reg_number, legal_address) values ($1, $2, $3, $4, $5)
        returning id, type, name, reg_number, legal_address, created_at`, [ctx.tenantId, b.type, text(b.name, '/name'), b.reg_number ?? null, b.legal_address ?? null])).rows[0];
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'client.create', objectType: 'client', objectId: r.id, after: clientOut(r) });
      return clientOut(r);
    });
  }

  @Op('getClient', 200)
  get(@Ctx() ctx: RequestContext, @Param('clientId') id: string) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const cl = await this.#client(c, id);
      const addresses = (await c.query(`select ${ADDRESS_COLS} from app.address a where a.client_id = $1 and a.deleted_at is null order by a.created_at`, [id])).rows;
      const contacts = (await c.query(`select ${CONTACT_COLS} from app.contact k where k.client_id = $1 and k.deleted_at is null order by k.created_at`, [id])).rows;
      const devices = (await c.query(`select ${DEVICE_LIST_COLS} from ${DEVICE_LIST_FROM} where d.client_id = $1 and d.deleted_at is null order by d.created_at`, [id])).rows;
      return {
        ...clientOut(cl), addresses: addresses.map(addressOut), contacts: contacts.map(contactOut),
        devices: await deviceListItems(this.telemetry, devices),
      };
    });
  }

  @Op('updateClient', 200)
  update(@Ctx() ctx: RequestContext, @Param('clientId') id: string, @Body() b: ClientBody) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const before = await this.#client(c, id, true);
      const r = (await c.query(`update app.client set type = $2, name = $3, reg_number = $4, legal_address = $5 where id = $1
        returning id, type, name, reg_number, legal_address, created_at`, [id, b.type, text(b.name, '/name'), b.reg_number ?? null, b.legal_address ?? null])).rows[0];
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'client.update', objectType: 'client', objectId: id, before: clientOut(before), after: clientOut(r) });
      return clientOut(r);
    });
  }

  @Op('deleteClient', 204)
  async remove(@Ctx() ctx: RequestContext, @Param('clientId') id: string): Promise<void> {
    await this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const before = await this.#client(c, id, true);
      const n = (await c.query(`select count(*)::int as n from app.device where client_id = $1 and deleted_at is null`, [id])).rows[0].n;
      if (n) throw conflict(`У клиента ${n} устройств — сначала перенесите их`);
      // Вместе с клиентом — его адреса, контакты и доступ End User.
      await c.query(`update app.client set deleted_at = now() where id = $1`, [id]);
      for (const t of ['address', 'contact', 'end_user_access']) await c.query(`update app.${t} set deleted_at = now() where client_id = $1 and deleted_at is null`, [id]);
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'client.delete', objectType: 'client', objectId: id, before: clientOut(before) });
    });
  }

  // ---------------------------------------------------------------- адреса

  @Op('createAddress', 201)
  async createAddress(@Ctx() ctx: RequestContext, @Param('clientId') clientId: string, @Body() b: AddressBody) {
    const address = text(b.address, '/address');
    const k = await this.#coords(b);
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      await this.#client(c, clientId, true);
      const r = (await c.query(`insert into app.address (tenant_id, client_id, address, region, lat, lng, coords_source, floor, place, access_note)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${ADDRESS_COLS.replaceAll('a.', '')}`,
      [ctx.tenantId, clientId, address, b.region ?? null, k.lat, k.lng, k.source, b.floor ?? null, b.place ?? null, b.access_note ?? null])).rows[0];
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'address.create', objectType: 'address', objectId: r.id, after: addressOut(r) });
      return addressOut(r);
    });
  }

  @Op('updateAddress', 200)
  async updateAddress(@Ctx() ctx: RequestContext, @Param('addressId') id: string, @Body() b: AddressBody) {
    const address = text(b.address, '/address');
    const k = await this.#coords(b);
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const before = await this.#row(c, 'address', id, true);
      const r = (await c.query(`update app.address set address = $2, region = $3, lat = $4, lng = $5, coords_source = $6, floor = $7, place = $8, access_note = $9
        where id = $1 returning ${ADDRESS_COLS.replaceAll('a.', '')}`,
      [id, address, b.region ?? null, k.lat, k.lng, k.source, b.floor ?? null, b.place ?? null, b.access_note ?? null])).rows[0];
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'address.update', objectType: 'address', objectId: id, before: addressOut(before), after: addressOut(r) });
      return addressOut(r);
    });
  }

  @Op('deleteAddress', 204)
  async removeAddress(@Ctx() ctx: RequestContext, @Param('addressId') id: string): Promise<void> {
    await this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const before = await this.#row(c, 'address', id, true);
      const n = (await c.query(`select count(*)::int as n from app.device where address_id = $1 and deleted_at is null`, [id])).rows[0].n;
      if (n) throw conflict(`На адресе ${n} устройств — сначала перенесите их`);
      await c.query(`update app.address set deleted_at = now() where id = $1`, [id]);
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'address.delete', objectType: 'address', objectId: id, before: addressOut(before) });
    });
  }

  // ---------------------------------------------------------------- контакты

  @Op('createContact', 201)
  createContact(@Ctx() ctx: RequestContext, @Param('clientId') clientId: string, @Body() b: ContactBody) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      await this.#client(c, clientId, true);
      const r = (await c.query(`insert into app.contact (tenant_id, client_id, name, phone, email, role, comment) values ($1, $2, $3, $4, $5, $6, $7)
        returning ${CONTACT_COLS.replaceAll('k.', '')}`, [ctx.tenantId, clientId, text(b.name, '/name'), b.phone ?? null, b.email ?? null, b.role ?? null, b.comment ?? null])).rows[0];
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'contact.create', objectType: 'contact', objectId: r.id, after: contactOut(r) });
      return contactOut(r);
    });
  }

  @Op('updateContact', 200)
  updateContact(@Ctx() ctx: RequestContext, @Param('contactId') id: string, @Body() b: ContactBody) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const before = await this.#row(c, 'contact', id, true);
      const r = (await c.query(`update app.contact set name = $2, phone = $3, email = $4, role = $5, comment = $6 where id = $1
        returning ${CONTACT_COLS.replaceAll('k.', '')}`, [id, text(b.name, '/name'), b.phone ?? null, b.email ?? null, b.role ?? null, b.comment ?? null])).rows[0];
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'contact.update', objectType: 'contact', objectId: id, before: contactOut(before), after: contactOut(r) });
      return contactOut(r);
    });
  }

  @Op('deleteContact', 204)
  async removeContact(@Ctx() ctx: RequestContext, @Param('contactId') id: string): Promise<void> {
    await this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const before = await this.#row(c, 'contact', id, true);
      await c.query(`update app.contact set deleted_at = now() where id = $1`, [id]);
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'contact.delete', objectType: 'contact', objectId: id, before: contactOut(before) });
    });
  }
}
