// Реестр устройств (§4.2: V-010…V-014, P-09) и карта (§4.3: V-025…V-027). Изменять — Admin и Tech, смотреть —
// плюс Exec и Dispatcher (§7.1). Перенос, статус жизненного цикла, аренда/покупка — с историей (device_history).
import { Body, Controller, Inject, Param, Query } from '@nestjs/common';
import type pg from 'pg';
import { Ctx, Op } from '../http/op.ts';
import { Problem, conflict, notFound } from '../http/problem.ts';
import { Db } from '../db/db.service.ts';
import type { RequestContext } from '../auth/context.ts';
import { audit } from '../audit.ts';
import { cursorTs, decodeCursor, encodeCursor, UUID } from './accounts.ts';
import { TELEMETRY, type TelemetrySource } from '../telemetry.ts';
import { DEVICE_COLS, DEVICE_LIST_COLS, DEVICE_LIST_FROM, deviceFilters, deviceListItems, deviceOut, parseSort, type Q } from './devices.shared.ts';
import { text } from './clients.controller.ts';
import { ADDRESS_COLS, addressOut, CLIENT_COLS, clientOut } from './clients.shared.ts';

type Model = { water_source: string; variant: string; carbonated: boolean; sku?: string | null };
const bad = (path: string, message: string) => new Problem(422, message, { errors: [{ path, message }] });

/**
 * Курсор списка устройств: [поле сортировки, id последней строки] — короткий при любой длине значений
 * (имя клиента до 200 символов не влезло бы в 512). Значение сортировки берётся из БД по id (якорь).
 */
function decodeSortCursor(s: string | undefined, field: string): string | null {
  if (!s) return null;
  try {
    const v = JSON.parse(Buffer.from(s, 'base64url').toString()) as unknown;
    if (Array.isArray(v) && v.length === 2 && v[0] === field && typeof v[1] === 'string' && UUID.test(v[1])) return v[1];
  } catch { /* ниже */ }
  throw bad('/cursor', 'неверный курсор');
}

@Controller()
export class DevicesController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(TELEMETRY) private readonly telemetry: TelemetrySource) {}

  async #device(c: pg.PoolClient, id: string, lock = false) {
    if (!UUID.test(id)) throw notFound();
    const r = (await c.query(`select ${DEVICE_COLS} from app.device d where d.id = $1 and d.deleted_at is null ${lock ? 'for no key update' : ''}`, [id])).rows[0];
    if (!r) throw notFound('Нет такого устройства');
    return r;
  }

  async #out(id: string, r: Record<string, any>) {
    return deviceOut(r, (await this.telemetry.states([id])).get(id)!);
  }

  async #history(c: pg.PoolClient, ctx: RequestContext, deviceId: string, field: string, before: unknown, after: unknown, comment?: string | null) {
    await c.query(`insert into app.device_history (tenant_id, device_id, by, field, before, after, comment) values ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.tenantId, deviceId, ctx.userId, field, JSON.stringify(before), JSON.stringify(after), comment ?? null]);
  }

  // ---------------------------------------------------------------- список и карточка

  @Op('listDevices', 200)
  list(@Ctx() ctx: RequestContext, @Query() q: Q) {
    const limit = Number(q['limit'] ?? 50);
    const { field, desc, sort } = parseSort(q);
    const cur = decodeSortCursor(q['cursor'] as string | undefined, field);
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const args: unknown[] = [];
      const where = await deviceFilters(this.telemetry, q, args);
      if (!where) return { items: [], next_cursor: null };
      let anchor = '';
      if (cur) {
        args.push(cur);
        anchor = `with anchor as (select ${sort.expr} as v, d.id from ${DEVICE_LIST_FROM} where d.id = $${args.length}::uuid) `;
        where.push(`(${sort.expr}, d.id) ${desc ? '<' : '>'} (select v, id from anchor)`);
      }
      const rows = (await c.query(
        `${anchor}select ${DEVICE_LIST_COLS}
         from ${DEVICE_LIST_FROM} where ${where.join(' and ')}
         order by ${sort.expr} ${desc ? 'desc' : 'asc'}, d.id ${desc ? 'desc' : 'asc'} limit ${limit + 1}`, args)).rows;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: await deviceListItems(this.telemetry, page),
        next_cursor: rows.length > limit && last ? Buffer.from(JSON.stringify([field, last.id])).toString('base64url') : null,
      };
    });
  }

  @Op('getDevice', 200)
  get(@Ctx() ctx: RequestContext, @Param('deviceId') id: string) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      if (!UUID.test(id)) throw notFound();
      const r = (await c.query(`select ${DEVICE_LIST_COLS} from ${DEVICE_LIST_FROM} where d.id = $1 and d.deleted_at is null`, [id])).rows[0];
      if (!r) throw notFound('Нет такого устройства');
      const live = (await this.telemetry.states([id])).get(id)!;
      const client = r.client_id ? (await c.query(`select ${CLIENT_COLS} from app.client c where c.id = $1`, [r.client_id])).rows[0] : null;
      const addr = r.address_id ? (await c.query(`select ${ADDRESS_COLS} from app.address a where a.id = $1`, [r.address_id])).rows[0] : null;
      return {
        ...deviceOut(r, live),
        client: client ? clientOut(client) : null,
        address_detail: addr ? addressOut(addr) : null,
        current: null, // последний кадр — от дорожки «Устройство»
        alerts_open: live.alerts_open,
        ota_allowed: null, // по последнему hello — от дорожки «Устройство»
      };
    });
  }

  // ---------------------------------------------------------------- создание и изменение

  @Op('createDevice', 201)
  create(@Ctx() ctx: RequestContext, @Body() b: { device_id: string; serial: string; imei?: string | null; model: Model; hw?: string | null; ownership?: string; description?: string | null }) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      b = { ...b, serial: text(b.serial, '/serial') };
      await this.#unique(c, null, b);
      const r = (await c.query(`insert into app.device (tenant_id, device_id, serial, imei, water_source, variant, carbonated, sku, hw, ownership, description)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::app.ownership, 'purchase'), $11) returning ${DEVICE_COLS.replaceAll('d.', '')}`,
      [ctx.tenantId, b.device_id, b.serial, b.imei ?? null, b.model.water_source, b.model.variant, b.model.carbonated, b.model.sku ?? null,
        b.hw ?? null, b.ownership ?? null, b.description ?? null])).rows[0];
      const out = await this.#out(r.id, r);
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'device.create', objectType: 'device', objectId: r.id,
        after: { device_id: r.device_id, serial: r.serial, imei: r.imei, model: out.model, ownership: r.ownership } });
      return out;
    });
  }

  /**
   * Уникальность V-011 с понятным 409: Device ID — во всей платформе, IMEI — во всей платформе, серийник — у арендатора.
   * Device ID и IMEI чужого арендатора проверяются функцией без раскрытия, чей он.
   */
  async #unique(c: pg.PoolClient, selfId: string | null, b: { device_id?: string; serial?: string; imei?: string | null }) {
    if (b.serial && (await c.query(`select 1 from app.device where serial = $1 and deleted_at is null and ($2::uuid is null or id <> $2)`, [b.serial, selfId])).rowCount) {
      throw conflict('Устройство с таким серийным номером уже есть');
    }
    const taken = (await c.query(`select * from app.device_identity_taken($1, $2, $3)`, [b.device_id ?? null, b.imei ?? null, selfId])).rows[0];
    if (taken?.device_id_taken) throw conflict('Device ID уже занят');
    if (taken?.imei_taken) throw conflict('IMEI уже занят');
  }

  @Op('updateDevice', 200)
  update(@Ctx() ctx: RequestContext, @Param('deviceId') id: string, @Body() b: { serial?: string; imei?: string | null; model?: Model; hw?: string | null; description?: string | null }) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const before = await this.#device(c, id, true);
      if (b.serial !== undefined) b = { ...b, serial: text(b.serial, '/serial') };
      await this.#unique(c, id, { ...(b.serial ? { serial: b.serial } : {}), ...(b.imei ? { imei: b.imei } : {}) });
      const set: string[] = [];
      const args: unknown[] = [id];
      const put = (col: string, v: unknown) => { args.push(v); set.push(`${col} = $${args.length}`); };
      if (b.serial !== undefined) put('serial', b.serial);
      if (b.imei !== undefined) put('imei', b.imei);
      if (b.hw !== undefined) put('hw', b.hw);
      if (b.description !== undefined) put('description', b.description);
      if (b.model) { put('water_source', b.model.water_source); put('variant', b.model.variant); put('carbonated', b.model.carbonated); put('sku', b.model.sku ?? null); }
      const r = (await c.query(`update app.device set ${set.join(', ')} where id = $1 returning ${DEVICE_COLS.replaceAll('d.', '')}`, args)).rows[0];
      const pick = (x: Record<string, any>) => ({ serial: x.serial, imei: x.imei, hw: x.hw, description: x.description, water_source: x.water_source, variant: x.variant, carbonated: x.carbonated, sku: x.sku });
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'device.update', objectType: 'device', objectId: id, before: pick(before), after: pick(r) });
      return this.#out(id, r);
    });
  }

  @Op('transferDevice', 200)
  transfer(@Ctx() ctx: RequestContext, @Param('deviceId') id: string, @Body() b: { client_id: string | null; address_id: string | null; comment?: string | null }) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const before = await this.#device(c, id, true);
      if (b.client_id === null && b.address_id !== null) throw bad('/address_id', 'без клиента адреса нет');
      // Целевые клиент и адрес — под блокировкой (FOR NO KEY UPDATE, как при их удалении): параллельное удаление либо
      // увидит перенесённое устройство (409), либо закончится раньше — и перенос получит 404.
      if (b.client_id && (!UUID.test(b.client_id)
        || !(await c.query(`select 1 from app.client where id = $1 and deleted_at is null for no key update`, [b.client_id])).rowCount)) throw notFound('Нет такого клиента');
      if (b.address_id) {
        const a = (await c.query(`select client_id from app.address where id = $1 and deleted_at is null for no key update`, [b.address_id])).rows[0];
        if (!a) throw notFound('Нет такого адреса');
        if (a.client_id !== b.client_id) throw bad('/address_id', 'адрес не принадлежит клиенту');
      }
      const r = (await c.query(`update app.device set client_id = $2, address_id = $3 where id = $1 returning ${DEVICE_COLS.replaceAll('d.', '')}`, [id, b.client_id, b.address_id])).rows[0];
      if (before.client_id !== b.client_id) await this.#history(c, ctx, id, 'client', before.client_id, b.client_id, b.comment);
      if (before.address_id !== b.address_id) await this.#history(c, ctx, id, 'address', before.address_id, b.address_id, b.comment);
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'device.transfer', objectType: 'device', objectId: id,
        before: { client_id: before.client_id, address_id: before.address_id }, after: { client_id: b.client_id, address_id: b.address_id } });
      return this.#out(id, r);
    });
  }

  async #set(ctx: RequestContext, id: string, field: 'lifecycle' | 'ownership', value: string, comment?: string | null) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const before = await this.#device(c, id, true);
      if (before[field] === value) return this.#out(id, before); // без изменения — без истории
      const r = (await c.query(`update app.device set ${field} = $2::app.${field} where id = $1 returning ${DEVICE_COLS.replaceAll('d.', '')}`, [id, value])).rows[0];
      await this.#history(c, ctx, id, field, before[field], value, comment);
      await audit(c, ctx, { tenantId: ctx.tenantId, action: `device.${field}`, objectType: 'device', objectId: id, before: { [field]: before[field] }, after: { [field]: value } });
      return this.#out(id, r);
    });
  }

  @Op('setLifecycle', 200)
  setLifecycle(@Ctx() ctx: RequestContext, @Param('deviceId') id: string, @Body() b: { lifecycle: string; comment?: string | null }) { return this.#set(ctx, id, 'lifecycle', b.lifecycle, b.comment); }

  @Op('setOwnership', 200)
  setOwnership(@Ctx() ctx: RequestContext, @Param('deviceId') id: string, @Body() b: { ownership: string; comment?: string | null }) { return this.#set(ctx, id, 'ownership', b.ownership, b.comment); }

  @Op('getDeviceHistory', 200)
  history(@Ctx() ctx: RequestContext, @Param('deviceId') id: string, @Query() q: Q) {
    const limit = Number(q['limit'] ?? 50);
    const cur = decodeCursor(q['cursor'] as string | undefined);
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      await this.#device(c, id);
      const args: unknown[] = [id];
      let extra = '';
      if (cur) { args.push(cur[0], cur[1]); extra = `and (h.at, h.id) < ($2::timestamptz, $3::uuid)`; }
      const rows = (await c.query(`select h.id, h.at, h.by, h.field, h.before, h.after, h.comment, ${cursorTs('h.at')} from app.device_history h
        where h.device_id = $1 ${extra} order by h.at desc, h.id desc limit ${limit + 1}`, args)).rows;
      const page = rows.slice(0, limit);
      return {
        items: page.map((h) => ({ at: h.at.toISOString(), by: h.by, field: h.field, before: h.before, after: h.after, comment: h.comment })),
        next_cursor: rows.length > limit ? encodeCursor(page.at(-1)!) : null,
      };
    });
  }

  // ---------------------------------------------------------------- карта

  /**
   * Карта (V-025…V-027): устройства с координатами адреса в рамке; кластеры — на сервере по сетке, зависящей от
   * масштаба (ячейка ≈ 64 px). Цвет: зелёный online, серый offline, красный — открытый алерт, жёлтый — предупреждение.
   */
  @Op('getMap', 200)
  map(@Ctx() ctx: RequestContext, @Query() q: Q) {
    const [minLng, minLat, maxLng, maxLat] = String(q['bbox']).split(',').map(Number) as [number, number, number, number];
    if ([minLng, minLat, maxLng, maxLat].some((x) => !Number.isFinite(x)) || minLng > maxLng || minLat > maxLat
      || minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) throw bad('/bbox', 'рамка: min_lng,min_lat,max_lng,max_lat');
    const zoom = Number(q['zoom']);
    const cell = 360 / 2 ** zoom / 4;
    // Ячейки и раскрытые маркеры — в одном снимке: перенос устройства между запросами не даст точку вне рамки.
    return this.db.tx({ tenantId: ctx.tenantId, snapshot: true }, async (c) => {
      const args: unknown[] = [];
      const where = await deviceFilters(this.telemetry, { ...q, q: undefined }, args);
      if (!where) return { clusters: [], devices: [] };
      args.push(minLng, minLat, maxLng, maxLat, cell);
      const n = args.length;
      where.push(`a.lat is not null and a.lng is not null and a.lng between $${n - 4} and $${n - 2} and a.lat between $${n - 3} and $${n - 1}`);
      // Ячейки сетки — в SQL, без лимита: ни одно устройство в рамке не теряется.
      const cellsRows = (await c.query(
        `select count(*)::int as n, avg(a.lat) as lat, avg(a.lng) as lng,
                (min(a.lat) = max(a.lat) and min(a.lng) = max(a.lng)) as same_point, array_agg(d.id) as ids
         from ${DEVICE_LIST_FROM} where ${where.join(' and ')}
         group by floor(a.lng / $${n}), floor(a.lat / $${n})`, args)).rows as { n: number; lat: number; lng: number; same_point: boolean; ids: string[] }[];
      const live = await this.telemetry.states(cellsRows.flatMap((r) => r.ids));
      const colorOf = (id: string) => {
        const s = live.get(id)!;
        return s.alerts_open > 0 ? 'red' : s.state === 'warning' ? 'yellow' : s.online ? 'green' : 'grey';
      };
      // Одно устройство, крупный масштаб или все в одной точке (один адрес) — отдельные маркеры: несколько кулеров
      // на одном адресе различимы по этажу и месту (P-05, V-027).
      const expand = cellsRows.filter((r) => r.n === 1 || zoom >= 17 || r.same_point);
      const clusters = cellsRows.filter((r) => !expand.includes(r)).map((r) => {
        const by: Record<string, number> = {};
        for (const id of r.ids) by[colorOf(id)] = (by[colorOf(id)] ?? 0) + 1;
        return { lat: Number(r.lat), lng: Number(r.lng), count: r.n, by_color: by };
      });
      const ids = expand.flatMap((r) => r.ids);
      const rows = ids.length ? (await c.query(`select ${DEVICE_LIST_COLS} from ${DEVICE_LIST_FROM} where d.id = any($1)`, [ids])).rows : [];
      const items = await deviceListItems(this.telemetry, rows);
      const devices = items.map((i, k) => ({ id: i.id, lat: rows[k].lat, lng: rows[k].lng, color: colorOf(i.id), client_name: i.client_name,
        address: i.address, floor: i.floor, place: i.place, filter_left_pct: i.filter_left_pct, alerts_open: i.alerts_open }));
      return { clusters, devices };
    });
  }
}

