// Настройки платформы (V-006, §7.4): пороги офлайна, алертов температуры, фильтра, список замен, окно прогноза.
// Наследование — платформа → арендатор → устройство (§7.2); `null` в запросе — снять переопределение своего уровня.
// Перечень ключей и границы — из схем Settings / SettingsWrite контракта; Admin (§7.1).
import { Body, Controller, Inject, Param } from '@nestjs/common';
import type pg from 'pg';
import { Ctx, Op } from '../http/op.ts';
import { Problem, notFound } from '../http/problem.ts';
import { Db } from '../db/db.service.ts';
import type { RequestContext } from '../auth/context.ts';
import { component } from '../openapi/spec.ts';
import { audit } from '../audit.ts';
import { UUID } from './accounts.ts';

type Level = 'platform' | 'tenant' | 'device';
type Values = Record<string, { value: number; level: Level }>;

const KEYS = (): string[] => Object.keys((component('Settings')['properties'] as Record<string, unknown>));

@Controller()
export class SettingsController {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** Действующие значения и уровень каждого; device — с переопределениями устройства. */
  async #values(c: pg.PoolClient, deviceId: string | null): Promise<Values> {
    const keys = KEYS();
    const rows = (await c.query(
      `select k.key,
              coalesce(sd.value, st.value, k.value) as value,
              case when sd.value is not null then 'device' when st.value is not null then 'tenant' else 'platform' end as level
       from app.setting_default k
       left join app.setting st on st.tenant_id = app.current_tenant() and st.device_id is null and st.key = k.key
       left join app.setting sd on $2::uuid is not null and sd.device_id = $2::uuid and sd.key = k.key
       where k.key = any($1)`, [keys, deviceId])).rows;
    const out: Values = {};
    for (const r of rows) out[r.key] = { value: Number(r.value), level: r.level };
    for (const k of keys) if (!out[k]) throw new Problem(500, `нет значения по умолчанию для ${k}`);
    return out;
  }

  async #device(c: pg.PoolClient, id: string, lock: boolean): Promise<void> {
    if (!UUID.test(id)) throw notFound();
    const r = await c.query(`select 1 from app.device where id = $1 and deleted_at is null ${lock ? 'for no key update' : ''}`, [id]);
    if (!r.rowCount) throw notFound('Нет такого устройства');
  }

  async #update(ctx: RequestContext, deviceId: string | null, b: Record<string, number | null>) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      // Все изменения настроек арендатора и его устройств — по очереди, через одну блокировку строки арендатора:
      // правило «критичный ≤ предупреждения» сравнивает значения обоих уровней, и параллельные изменения
      // арендатора и устройства не должны проверяться по устаревшему значению друг друга. Снимок «до» — актуальный.
      // FOR NO KEY UPDATE: взаимно исключает изменения настроек, но совместим с KEY SHARE, которую берут проверки
      // внешних ключей (сессии, аудит, пользователи арендатора), — без взаимных блокировок со входом и др.
      await c.query(`select 1 from app.tenant where id = app.current_tenant() for no key update`);
      if (deviceId) await this.#device(c, deviceId, true);
      const before = await this.#values(c, deviceId);
      for (const [key, value] of Object.entries(b)) {
        if (value === null) {
          await c.query(`delete from app.setting where tenant_id = app.current_tenant() and key = $1 and ${deviceId ? 'device_id = $2' : 'device_id is null'}`,
            deviceId ? [key, deviceId] : [key]);
        } else if (deviceId) {
          await c.query(`insert into app.setting (tenant_id, device_id, key, value, updated_by) values (app.current_tenant(), $1, $2, $3, $4)
            on conflict (device_id, key) where device_id is not null do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
            [deviceId, key, JSON.stringify(value), ctx.userId]);
        } else {
          await c.query(`insert into app.setting (tenant_id, device_id, key, value, updated_by) values (app.current_tenant(), null, $1, $2, $3)
            on conflict (tenant_id, key) where device_id is null do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
            [key, JSON.stringify(value), ctx.userId]);
        }
      }
      const after = await this.#values(c, deviceId);
      // Смысл: критичный порог фильтра не выше предупреждения (§7.4: ≤ 20 % — предупреждение, ≤ 5 % — критично).
      if (after['filter_critical_pct']!.value > after['filter_warning_pct']!.value) {
        throw new Problem(422, 'Критичный порог фильтра выше порога предупреждения', {
          errors: [{ path: '/filter_critical_pct', message: 'не выше filter_warning_pct' }],
        });
      }
      // Устройства: проверяется и то, что они унаследуют от нового значения арендатора.
      if (!deviceId) {
        const bad = (await c.query(
          `select d.id from app.device d
           where d.deleted_at is null
             and coalesce((select (value #>> '{}')::numeric from app.setting where device_id = d.id and key = 'filter_critical_pct'), $1)
               > coalesce((select (value #>> '{}')::numeric from app.setting where device_id = d.id and key = 'filter_warning_pct'), $2)
           limit 1`, [after['filter_critical_pct']!.value, after['filter_warning_pct']!.value])).rows[0];
        if (bad) {
          throw new Problem(422, 'У устройства критичный порог фильтра станет выше порога предупреждения', {
            errors: [{ path: '/filter_critical_pct', message: `устройство ${bad.id}` }],
          });
        }
      }
      const changed = Object.keys(b);
      await audit(c, ctx, {
        tenantId: ctx.tenantId, action: deviceId ? 'setting.device_update' : 'setting.tenant_update',
        objectType: deviceId ? 'device' : 'tenant', objectId: deviceId ?? ctx.tenantId,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      });
      return after;
    });
  }

  @Op('getSettings', 200)
  get(@Ctx() ctx: RequestContext) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => this.#values(c, null));
  }

  @Op('updateSettings', 200)
  update(@Ctx() ctx: RequestContext, @Body() b: Record<string, number | null>) { return this.#update(ctx, null, b); }

  @Op('getDeviceSettings', 200)
  getDevice(@Ctx() ctx: RequestContext, @Param('deviceId') id: string) {
    return this.db.tx({ tenantId: ctx.tenantId }, async (c) => {
      await this.#device(c, id, false);
      return this.#values(c, id);
    });
  }

  @Op('updateDeviceSettings', 200)
  updateDevice(@Ctx() ctx: RequestContext, @Param('deviceId') id: string, @Body() b: Record<string, number | null>) {
    return this.#update(ctx, id, b);
  }
}
