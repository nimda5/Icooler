// Массовая загрузка устройств из CSV и выгрузка реестра в CSV/XLSX (V-016). Загрузка — Admin и Tech, выгрузка — плюс
// Exec (§7.1). Строки с ошибками не загружаются, остальные — да; отчёт — по каждой строке. dry_run — только проверка.
import { Controller, Inject, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { Ctx, Op } from '../http/op.ts';
import { Problem } from '../http/problem.ts';
import { Db } from '../db/db.service.ts';
import type { RequestContext } from '../auth/context.ts';
import { audit } from '../audit.ts';
import { componentValidator } from '../openapi/spec.ts';
import { TELEMETRY, type TelemetrySource } from '../telemetry.ts';
import { CsvError, parseCsvRecords, toCsv, unsafeCell, type CsvRecord } from '../io/csv.ts';
import { toXlsx } from '../io/xlsx.ts';
import { DEVICE_COLS, DEVICE_LIST_COLS, DEVICE_LIST_FROM, deviceFilters, deviceListItems, parseSort, type Q } from './devices.shared.ts';

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
export const MAX_EXPORT_ROWS = 50_000;

/** Столбцы загрузки: так же называются и в выгрузке — выгруженный файл можно загрузить обратно (в другой арендатор). */
export const IMPORT_COLUMNS = ['device_id', 'serial', 'imei', 'water_source', 'variant', 'carbonated', 'sku', 'hw', 'ownership', 'description'] as const;
const REQUIRED = ['device_id', 'serial', 'water_source', 'variant', 'carbonated'];
/** Столбцы, которые есть только в выгрузке: при загрузке пропускаются (состояние, клиент — не из файла). */
const EXPORT_ONLY = ['lifecycle', 'state', 'online', 'client', 'address', 'region', 'floor', 'place', 'fw', 'filter_left_pct', 'alerts_open', 'last_seen_at', 'created_at'];
export const EXPORT_COLUMNS = [...IMPORT_COLUMNS, ...EXPORT_ONLY];

const bad = (path: string, message: string) => new Problem(422, message, { errors: [{ path, message }] });
type RowError = { row: number; column?: string; message: string };
type Report = { total: number; accepted: number; dry_run: boolean; errors: RowError[] };
class DryRun extends Error { constructor(readonly report: Report) { super('dry run'); } }

const BOOL: Record<string, boolean> = { true: true, false: false, yes: true, no: false, '1': true, '0': false, y: true, n: false, jā: true, nē: false, да: true, нет: false };

let validateRow: ReturnType<typeof componentValidator> | undefined;

/** Ошибки схемы DeviceCreate → столбец файла и понятный текст. */
function schemaErrors(row: number): RowError[] {
  return (validateRow!.errors ?? []).map((e) => {
    const column = e.instancePath.split('/').pop() || String((e.params as { missingProperty?: string }).missingProperty ?? '');
    const allowed = (e.params as { allowedValues?: unknown[] }).allowedValues;
    const message = allowed ? `допустимо: ${allowed.join(', ')}`
      : e.keyword === 'pattern' && column === 'imei' ? 'IMEI — 15 цифр'
      : e.keyword === 'pattern' && column === 'device_id' ? 'Device ID — латинские буквы, цифры и . _ : - (до 128)'
      : e.keyword === 'maxLength' ? `не длиннее ${(e.params as { limit: number }).limit} символов`
      : e.keyword === 'required' ? 'обязательное значение' : e.message ?? 'неверное значение';
    return { row, column, message };
  });
}

@Controller()
export class DeviceIoController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(TELEMETRY) private readonly telemetry: TelemetrySource) {}

  // ---------------------------------------------------------------- выгрузка

  @Op('exportDevices', 200)
  async export(@Ctx() ctx: RequestContext, @Query() q: Q, @Res({ passthrough: true }) res: FastifyReply) {
    const { desc, sort } = parseSort(q);
    const rows = await this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      const args: unknown[] = [];
      const where = await deviceFilters(this.telemetry, q, args);
      if (!where) return [];
      const r = (await c.query(`select ${DEVICE_LIST_COLS} from ${DEVICE_LIST_FROM} where ${where.join(' and ')}
        order by ${sort.expr} ${desc ? 'desc' : 'asc'}, d.id ${desc ? 'desc' : 'asc'} limit ${MAX_EXPORT_ROWS + 1}`, args)).rows;
      if (r.length > MAX_EXPORT_ROWS) throw bad('/format', `больше ${MAX_EXPORT_ROWS} устройств — сузьте фильтр`);
      return r;
    });
    const items = await deviceListItems(this.telemetry, rows); // тот же порядок, что rows
    const table: unknown[][] = [EXPORT_COLUMNS, ...items.map((d, i) => [
      d.device_id, d.serial, d.imei, d.model.water_source, d.model.variant, d.model.carbonated ? 'true' : 'false', d.model.sku, d.hw, d.ownership,
      d.description, d.lifecycle, d.state, d.online ? 'true' : 'false', d.client_name, d.address, rows[i]!.region ?? null,
      d.floor, d.place, d.fw, d.filter_left_pct, d.alerts_open, d.last_seen_at, d.created_at,
    ])];
    const day = new Date().toISOString().slice(0, 10);
    const xlsx = q['format'] === 'xlsx';
    res.header('Content-Type', xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="devices-${day}.${xlsx ? 'xlsx' : 'csv'}"`);
    res.header('Cache-Control', 'no-store');
    return xlsx ? toXlsx('Devices', table) : toCsv(table);
  }

  // ---------------------------------------------------------------- загрузка

  @Op('importDevices', 200)
  async import(@Ctx() ctx: RequestContext, @Query() q: Q, @Req() req: FastifyRequest): Promise<Report> {
    const dryRun = q['dry_run'] === true || q['dry_run'] === 'true';
    const text = await readCsvFile(req);
    let records: CsvRecord[];
    try { records = parseCsvRecords(text); } catch (e) {
      if (e instanceof CsvError) throw bad('/file', `CSV, строка ${e.row}: ${e.message}`);
      throw e;
    }
    if (!records.length) throw bad('/file', 'файл пуст');
    const header = records[0]!.cells.map((h) => h.trim().toLowerCase());
    const unknown = header.filter((h) => !EXPORT_COLUMNS.includes(h));
    if (unknown.length) throw bad('/file', `неизвестные столбцы: ${unknown.join(', ')}; допустимые: ${IMPORT_COLUMNS.join(', ')}`);
    const missing = REQUIRED.filter((h) => !header.includes(h));
    if (missing.length) throw bad('/file', `нет обязательных столбцов: ${missing.join(', ')}`);
    const dup = header.find((h, i) => header.indexOf(h) !== i);
    if (dup) throw bad('/file', `столбец ${dup} повторяется`);
    const data = records.slice(1);
    if (!data.length) throw bad('/file', 'в файле нет строк с устройствами');
    if (data.length > MAX_IMPORT_ROWS) throw bad('/file', `не больше ${MAX_IMPORT_ROWS} строк за раз`);
    validateRow ??= componentValidator('DeviceCreate');

    try {
      return await this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
        const report: Report = { total: data.length, accepted: 0, dry_run: dryRun, errors: [] };
        const seen = { device_id: new Map<string, number>(), serial: new Map<string, number>(), imei: new Map<string, number>() };
        // Загрузки — по одной на платформу: Device ID и IMEI уникальны во всей платформе, и две загрузки с одними
        // идентификаторами в разном порядке иначе взаимно блокировались бы на уникальных индексах.
        await c.query(`select pg_advisory_xact_lock(hashtext('icooler.device_import'))`);
        for (const { cells, line: row } of data) {
          const errors = await this.#row(c, ctx, header, cells, row, seen);
          if (errors.length) report.errors.push(...errors); else report.accepted++;
        }
        if (dryRun) throw new DryRun(report); // откат: проверка шла теми же вставками, что и загрузка
        if (report.accepted) {
          await audit(c, ctx, { tenantId: ctx.tenantId, action: 'device.import', objectType: 'device', objectId: null,
            after: { total: report.total, accepted: report.accepted, rejected: report.total - report.accepted } });
        }
        return report;
      });
    } catch (e) {
      if (e instanceof DryRun) return e.report;
      throw e;
    }
  }

  /** Одна строка: разбор, схема, повторы в файле, уникальность в БД, вставка под точкой сохранения. */
  async #row(c: pg.PoolClient, ctx: RequestContext, header: string[], cells: string[], row: number,
    seen: Record<'device_id' | 'serial' | 'imei', Map<string, number>>): Promise<RowError[]> {
    if (cells.length > header.length) return [{ row, message: `значений больше, чем столбцов (${cells.length} > ${header.length})` }];
    const nul = cells.findIndex((x) => x.includes('\u0000'));
    if (nul >= 0) return [{ row, column: header[nul]!, message: 'недопустимый символ (NUL)' }];
    // Идентификаторы и коды — без крайних пробелов; описание — свободный текст, как есть (выгрузка → загрузка без потерь).
    const raw = (k: string) => unsafeCell(cells[header.indexOf(k)] ?? '');
    const v = (k: string) => raw(k).trim();
    const opt = (k: string) => (header.includes(k) && v(k) !== '' ? v(k) : null);
    const text = (k: string) => (header.includes(k) && raw(k) !== '' ? raw(k) : null);
    const carb = v('carbonated').toLowerCase();
    if (!(carb in BOOL)) return [{ row, column: 'carbonated', message: 'true или false' }];
    const body: Record<string, unknown> = {
      device_id: v('device_id'), serial: v('serial'), imei: opt('imei'),
      model: { water_source: v('water_source'), variant: v('variant').toUpperCase(), carbonated: BOOL[carb], sku: opt('sku') },
      hw: opt('hw'), description: text('description'), ...(opt('ownership') ? { ownership: opt('ownership') } : {}),
    };
    if (!validateRow!(body)) return schemaErrors(row);
    const errors: RowError[] = [];
    for (const k of ['device_id', 'serial', 'imei'] as const) {
      const val = k === 'imei' ? (body.imei as string | null) : (body[k] as string);
      if (!val) continue;
      const first = seen[k].get(val);
      if (first) errors.push({ row, column: k, message: `повтор строки ${first}` }); else seen[k].set(val, row);
    }
    if (errors.length) return errors;
    if ((await c.query(`select 1 from app.device where serial = $1 and deleted_at is null`, [body.serial])).rowCount) {
      errors.push({ row, column: 'serial', message: 'устройство с таким серийным номером уже есть' });
    }
    const taken = (await c.query(`select * from app.device_identity_taken($1, $2, null)`, [body.device_id, body.imei])).rows[0];
    if (taken?.device_id_taken) errors.push({ row, column: 'device_id', message: 'Device ID уже занят' });
    if (taken?.imei_taken) errors.push({ row, column: 'imei', message: 'IMEI уже занят' });
    if (errors.length) return errors;
    const m = body.model as { water_source: string; variant: string; carbonated: boolean; sku: string | null };
    await c.query('savepoint import_row');
    try {
      const r = (await c.query(`insert into app.device (tenant_id, device_id, serial, imei, water_source, variant, carbonated, sku, hw, ownership, description)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::app.ownership, 'purchase'), $11) returning ${DEVICE_COLS.replaceAll('d.', '')}`,
      [ctx.tenantId, body.device_id, body.serial, body.imei, m.water_source, m.variant, m.carbonated, m.sku, body.hw, body.ownership ?? null, body.description])).rows[0];
      await audit(c, ctx, { tenantId: ctx.tenantId, action: 'device.create', objectType: 'device', objectId: r.id,
        after: { device_id: r.device_id, serial: r.serial, imei: r.imei, ownership: r.ownership, source: 'import', row } });
      await c.query('release savepoint import_row');
      return [];
    } catch (e) {
      await c.query('rollback to savepoint import_row');
      // параллельная вставка того же идентификатора — строка отклоняется, остальные идут дальше
      if ((e as { code?: string }).code === '23505') return [{ row, message: 'идентификатор уже занят (одновременная загрузка)' }];
      throw e;
    }
  }
}

/** Файл из multipart: ровно одна часть — файл в поле file, не больше 1 МБ, UTF-8. Все части читаются до записи в БД. */
async function readCsvFile(req: FastifyRequest): Promise<string> {
  if (!req.isMultipart()) throw bad('/file', 'нужен multipart/form-data с полем file');
  let buf: Buffer | undefined;
  try {
    // Лимиты с запасом в одну часть: часть сверх лимита busboy молча отбрасывает, а нам нужно её увидеть и отказать.
    for await (const part of req.parts({ limits: { fileSize: MAX_IMPORT_BYTES, files: 2, fields: 1, parts: 2 } })) {
      if (part.type !== 'file' || part.fieldname !== 'file' || buf) {
        if (part.type === 'file') await part.toBuffer().catch(() => undefined); // дочитать, чтобы дойти до ошибки лимита
        throw bad('/file', 'нужна одна часть — файл в поле file');
      }
      buf = await part.toBuffer();
    }
  } catch (e) {
    if (e instanceof Problem) throw e;
    const code = (e as { code?: string }).code ?? '';
    if (code === 'FST_REQ_FILE_TOO_LARGE') throw bad('/file', 'файл больше 1 МБ');
    if (code === 'FST_PARTS_LIMIT' || code === 'FST_FILES_LIMIT' || code === 'FST_FIELDS_LIMIT') throw bad('/file', 'нужна одна часть — файл в поле file');
    // Остальное — ошибки разбора самого multipart (busboy: нет boundary, оборванное тело) — это файл, а не сервер.
    throw bad('/file', 'не удалось прочитать файл');
  }
  if (!buf) throw bad('/file', 'нет поля file');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { throw bad('/file', 'файл не в UTF-8 — сохраните CSV в UTF-8'); }
}
