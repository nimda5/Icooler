// Виртуальный кулер с платой связи: тот же протокол, что у прошивки (ТЗ §7.3, FW-5, FW-6, FW-10).
import type { Clock, TimerId } from './clock.ts';
import { Rng, seedOf } from './random.ts';
import {
  parseSchedule, scheduleAllows, isTimezone, scheduleCrc, localDayMinute, type Schedule,
} from './schedule.ts';
import {
  isoSeconds, type Command, type DeviceEvent, type DeviceLink, type EventType, type Frame, type Model, type Outgoing,
  type Result,
} from './messages.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const FRAME_MS = 5 * MIN; // §7.4
const FRAMES_MAX = 864; // FW-5: 72 ч
const EVENTS_MAX = 1000; // FW-5
const CMDS_MAX = 100; // §7.3 п. 5
const FILTER_L = 25_000, FILTER_DAYS = 365, NWU_DAYS = 21; // unit.h: DEFAULT_FILTER_*
const BOTTLE_L = 18.9;
const AMBIENT = 22;
const CMD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface DeviceConfig {
  id: string;
  model: Model;
  fw?: string;
  hw?: string;
  seed?: number;
  timezone?: string;
  schedule?: string;
  scheduleVersion?: string;
  energySaving?: boolean;
  /** Время от включения до сверки часов с сетью и подключения, мс. */
  timeSyncMs?: number;
  /** Задержка ответа контроллера AT+LOAD после AT+PUSH, мс. */
  uartMs?: [number, number];
  /** Пауза перед переподключением после обрыва, мс. */
  reconnectMs?: [number, number];
  /** Множитель расхода воды. */
  usage?: number;
  operator?: string;
  /** Начальные счётчики: пролито через фильтр и общий объём, л. */
  filterUsedL?: number;
  waterTotalL?: number;
}

export interface Faults {
  /** Нагреватель не греет (HTR включён, температура падает). */
  heater: boolean;
  /** Охлаждение не охлаждает. */
  cooler: boolean;
  /** Контроллер не шлёт AT+LOAD: нет подтверждений, кадр со старыми данными. */
  controllerSilent: boolean;
  /** Ошибка записи в энергонезависимую память. */
  nvsFail: boolean;
  /** Кончился CO2 (модели с газированной водой). */
  co2Out: boolean;
}

interface CmdRecord { status: 'accepted' | 'executing' | 'done'; result?: Result; frame?: Frame }

/** То, что переживает перезагрузку и обрыв питания (NVS платы). */
interface Nvs {
  seq: number;
  waterTotal: number;
  filterUsed: number;
  filterResetAt: number;
  lastWaterAt: number;
  heatEnabled: boolean;
  coolEnabled: boolean;
  powerOn: boolean;
  energySaving: boolean;
  schedule: string;
  timezone: string;
  scheduleVersion: string | null;
  otaAllowed: boolean;
  bottleLiters: number;
  cmds: Map<string, CmdRecord>;
  /** Ожидания подтверждения контроллера (п. 8): переживают перезагрузку, каждое кончается событием. */
  waiters: Waiter[];
  /** Результаты, доставка которых не подтверждена (PUBACK), — досылаются при подключении. */
  unsentResults: Set<string>;
  /** Кадры и события до подтверждения доставки (буфер FW-5). */
  frames: Frame[];
  events: DeviceEvent[];
  framesLost: number;
  eventsLost: number;
  errors: Set<string>;
}

interface Load { heat: boolean; cool: boolean; tHot: number; tCold: number }
interface Waiter { cmdId: string; heat?: boolean; cool?: boolean; t0: number; deadline: number }

export interface DeviceStats { sent: Record<string, number>; dropped: number }

export class VirtualDevice {
  readonly id: string;
  readonly model: Model;
  readonly faults: Faults = { heater: false, cooler: false, controllerSilent: false, nvsFail: false, co2Out: false };
  readonly stats: DeviceStats = { sent: {}, dropped: 0 };

  readonly #clock: Clock;
  readonly #link: DeviceLink;
  readonly #rng: Rng;
  readonly #cfg: Required<Pick<DeviceConfig, 'fw' | 'hw' | 'timeSyncMs' | 'uartMs' | 'reconnectMs' | 'usage' | 'operator'>>;
  readonly #nvs: Nvs;
  readonly #tHotSet: number;
  readonly #tColdSet: number;
  readonly #baseRsrp: number;
  /** Сеть недоступна до этого момента (потеря LTE не зависит от перезагрузки платы). */
  #lteUntil = 0;

  // Состояние до перезагрузки.
  #powered = false;
  #synced = false;
  #firstFrame = true;
  #timers = new Map<TimerId, true>();
  #ctrl = { heat: false, cool: false }; // фактическое состояние контроллера (HTR/CLR)
  #target = { heat: false, cool: false }; // последнее отправленное AT+PUSH
  #pushSeq = 0;
  #appliedSeq = 0;
  #load: Load; // последняя строка AT+LOAD, которую видела плата
  #inflight = new Map<number, { m: Extract<Outgoing, { mt: 'frame' | 'event' }>; attempt: number }>(); // без подтверждения
  #attempt = 0;
  #tHot = AMBIENT;
  #tCold = AMBIENT;
  #bottlePresent = true;
  #uvc = false;
  #minute = 0;
  #schedule: Schedule | null = null;

  constructor(clock: Clock, link: DeviceLink, cfg: DeviceConfig) {
    this.id = cfg.id;
    this.model = cfg.model;
    this.#clock = clock;
    this.#link = link;
    this.#rng = new Rng(cfg.seed ?? seedOf(cfg.id));
    this.#cfg = {
      fw: cfg.fw ?? 'sim-0.1.0',
      hw: cfg.hw ?? 'esp32c3-rev1',
      timeSyncMs: cfg.timeSyncMs ?? 5_000,
      uartMs: cfg.uartMs ?? [200, 1500],
      reconnectMs: cfg.reconnectMs ?? [5_000, 30_000],
      usage: cfg.usage ?? 1,
      operator: cfg.operator ?? 'LMT',
    };
    const now = clock.now();
    const schedule = cfg.schedule ?? '';
    this.#nvs = {
      seq: 0, waterTotal: cfg.waterTotalL ?? cfg.filterUsedL ?? 0, filterUsed: cfg.filterUsedL ?? 0,
      filterResetAt: now, lastWaterAt: now,
      heatEnabled: true, coolEnabled: true, powerOn: true, energySaving: cfg.energySaving ?? false,
      schedule, timezone: cfg.timezone ?? 'Europe/Riga',
      scheduleVersion: cfg.scheduleVersion ?? (schedule ? isoLocal(now) : null),
      otaAllowed: false, bottleLiters: 0,
      cmds: new Map(), waiters: [], unsentResults: new Set(), frames: [], events: [], framesLost: 0, eventsLost: 0, errors: new Set(),
    };
    this.#schedule = this.#parsed(schedule);
    this.#tHotSet = this.#rng.int(85, 92);
    this.#tColdSet = this.#rng.int(4, 8);
    this.#baseRsrp = this.#rng.between(-108, -82);
    this.#load = { heat: false, cool: false, tHot: AMBIENT, tCold: AMBIENT };
    link.onConnect(() => this.#onConnect());
    link.onDisconnect(() => this.#onDisconnect());
    link.onCommand((raw) => this.#onCommand(raw));
  }

  get powered(): boolean { return this.#powered; }
  get connected(): boolean { return this.#link.connected; }
  /** Снимок для тестов и отчётов. */
  get state() {
    const n = this.#nvs;
    return {
      seq: n.seq, waterTotal: n.waterTotal, filterUsed: n.filterUsed, powerOn: n.powerOn, heatEnabled: n.heatEnabled,
      coolEnabled: n.coolEnabled, energySaving: n.energySaving, schedule: n.schedule, timezone: n.timezone,
      scheduleVersion: n.scheduleVersion, otaAllowed: n.otaAllowed, bufferedFrames: n.frames.length,
      bufferedEvents: n.events.length, inflight: this.#inflight.size, ctrl: { ...this.#ctrl }, tHot: this.#tHot,
      tCold: this.#tCold, errors: [...n.errors],
    };
  }

  // ---- питание и связь ----

  /** Включение (старт после подачи питания, перезагрузки или обновления). */
  powerOn(reason: 'power' | 'watchdog' | 'update' | 'other' = 'power'): void {
    if (this.#powered) return;
    this.#powered = true;
    this.#synced = false;
    this.#firstFrame = true;
    this.#minute = 0;
    this.#tHot = this.#tCold = AMBIENT;
    this.#ctrl = { heat: false, cool: false };
    this.#target = { heat: false, cool: false };
    this.#appliedSeq = this.#pushSeq;
    this.#load = { heat: false, cool: false, tHot: AMBIENT, tCold: AMBIENT };
    this.#bottlePresent = true;
    // Ожидания подтверждения, прерванные перезагрузкой: срок — прежний; прошёл — сразу not_confirmed.
    for (const w of this.#nvs.waiters) this.#watchDeadline(w);
    // Команды, прерванные перезагрузкой, не возобновляются; результат досылается при подключении (§7.3 п. 5).
    for (const [id, rec] of this.#nvs.cmds) {
      if (rec.status !== 'done') {
        rec.status = 'done';
        rec.result = { v: 0, cmd_id: id, code: 400, message: 'interrupted by reboot' };
        this.#nvs.unsentResults.add(id);
      }
    }
    this.#event('reboot', { code: reason });
    this.#enforce();
    this.#after(this.#cfg.timeSyncMs, () => { this.#synced = true; this.#tryConnect(); });
    this.#after(MIN, () => this.#tick());
    this.#after(this.#rng.between(0, FRAME_MS), () => this.#frameTick());
  }

  /** Обрыв питания: всё, кроме NVS, теряется. */
  powerOff(): void {
    if (!this.#powered) return;
    this.#powered = false;
    for (const t of this.#timers.keys()) this.#clock.clearTimeout(t);
    this.#timers.clear();
    this.#link.disconnect();
    this.#requeue();
  }

  /** Перезагрузка (сторожевой таймер, обновление). */
  reboot(reason: 'watchdog' | 'update' | 'other' = 'watchdog'): void {
    this.powerOff();
    this.powerOn(reason);
  }

  /** Потеря LTE на ms: кадры и события копятся в буфере (FW-5), затем досылаются. Переживает перезагрузку. */
  lteLoss(ms: number): void {
    this.#lteUntil = Math.max(this.#lteUntil, this.#clock.now() + ms);
    this.#link.disconnect();
    this.#after(ms, () => this.#tryConnect());
  }

  /** Изменение расписания на месте через Bluetooth-приложение (§7.3, «Изменение на месте»). */
  localScheduleEdit(schedule: string): boolean {
    const parsed = this.#parsed(schedule);
    if (schedule && !parsed) return false;
    const n = this.#nvs;
    n.schedule = schedule;
    n.scheduleVersion = isoLocal(this.#clock.now());
    this.#schedule = parsed;
    this.#event('schedule_applied', {
      data: { version: n.scheduleVersion, source: 'local', schedule: n.schedule, timezone: n.timezone },
    });
    this.#enforce();
    return true;
  }

  #tryConnect(): void {
    if (!this.#powered || !this.#synced || this.#link.connected) return;
    const wait = this.#lteUntil - this.#clock.now();
    if (wait > 0) { this.#after(wait, () => this.#tryConnect()); return; }
    this.#link.connect();
  }

  #onConnect(): void {
    if (!this.#powered) return;
    const n = this.#nvs;
    this.#send({
      mt: 'hello',
      body: {
        v: 0, device_id: this.id, ts: this.#ts(), fw: this.#cfg.fw, hw: this.#cfg.hw, model: this.model,
        schedule_version: n.scheduleVersion, ota_allowed: n.otaAllowed,
        ...(n.scheduleVersion?.startsWith('local:') ? { schedule: n.schedule, timezone: n.timezone } : {}),
      },
    });
    // Результаты, доставка которых не подтверждена, — после ack платформа больше не повторяет команду (п. 3).
    for (const id of [...n.unsentResults]) {
      const r = n.cmds.get(id)?.result;
      if (r) this.#sendResult(r); else n.unsentResults.delete(id);
    }
    // Досылка буфера по порядку seq; из буфера сообщение уходит только по подтверждению (FW-5).
    const queued: Extract<Outgoing, { mt: 'frame' | 'event' }>[] = [
      ...n.frames.map((body) => ({ mt: 'frame', body }) as const),
      ...n.events.map((body) => ({ mt: 'event', body }) as const),
    ].sort((a, b) => a.body.seq - b.body.seq);
    n.frames = [];
    n.events = [];
    for (const m of queued) this.#sendReliable(m);
    if (n.framesLost || n.eventsLost) {
      const data = { frames_lost: n.framesLost, events_lost: n.eventsLost };
      n.framesLost = n.eventsLost = 0;
      this.#event('buffer_overflow', { data });
    }
  }

  #onDisconnect(): void {
    this.#requeue();
    // Обрыв не по нашей воле — переподключение с паузой.
    if (this.#powered && this.#synced) this.#after(this.#rng.between(...this.#cfg.reconnectMs), () => this.#tryConnect());
  }

  /** Неподтверждённые кадры и события — обратно в буфер (повтор допустим: платформа отбрасывает по seq). */
  #requeue(): void {
    const n = this.#nvs;
    for (const { m } of this.#inflight.values()) {
      if (m.mt === 'frame') n.frames.push(m.body);
      else if (m.mt === 'event') n.events.push(m.body);
    }
    this.#inflight.clear();
    n.frames.sort((a, b) => a.seq - b.seq);
    n.events.sort((a, b) => a.seq - b.seq);
    this.#trim();
  }

  #trim(): void {
    const n = this.#nvs;
    while (n.frames.length > FRAMES_MAX) { n.frames.shift(); n.framesLost++; }
    while (n.events.length > EVENTS_MAX) { n.events.shift(); n.eventsLost++; }
  }

  // ---- периодическая работа ----

  #tick(): void {
    this.#minute++;
    this.#physics();
    this.#water();
    this.#enforce();
    this.#uvc = this.#minute % 60 < 5; // циклическое включение УФ-лампы (FW-10)
    this.#controllerLoad();
    this.#checkErrors();
    if (this.#link.connected) this.#send({ mt: 'heartbeat', body: { v: 0, device_id: this.id, ts: this.#ts() } });
    this.#after(MIN, () => this.#tick());
  }

  #frameTick(): void {
    this.#frame(null);
    this.#after(FRAME_MS, () => this.#frameTick());
  }

  #physics(): void {
    const r = this.#rng;
    if (this.#ctrl.heat && !this.faults.heater) this.#tHot += (this.#tHotSet - this.#tHot) * 0.3;
    else this.#tHot += (AMBIENT - this.#tHot) * 0.02;
    if (this.#ctrl.cool && !this.faults.cooler) this.#tCold += (this.#tColdSet - this.#tCold) * 0.15;
    else this.#tCold += (AMBIENT + 2 - this.#tCold) * 0.03;
    this.#tHot += r.between(-0.2, 0.2);
    this.#tCold += r.between(-0.1, 0.1);
  }

  #water(): void {
    const now = this.#clock.now();
    const top = this.model.water_source === 'bottle_top';
    if (top && !this.#bottlePresent) return;
    const { day, minute } = localDayMinute(now, this.#nvs.timezone);
    const work = day <= 5 && minute >= 8 * 60 && minute < 19 * 60;
    const draws = this.#rng.poisson((work ? 0.12 : day > 5 ? 0.02 : 0.005) * this.#cfg.usage);
    if (!draws) return;
    let litres = 0;
    for (let i = 0; i < draws; i++) litres += this.#rng.between(0.2, 0.5);
    const n = this.#nvs;
    n.waterTotal = round(n.waterTotal + litres, 2);
    n.filterUsed = round(n.filterUsed + litres, 2);
    n.lastWaterAt = now;
    this.#tHot -= litres * 1.5;
    this.#tCold += litres * 1.0;
    if (top) {
      n.bottleLiters += litres;
      if (n.bottleLiters >= BOTTLE_L) {
        this.#bottlePresent = false;
        this.#event('bottle_removed', {});
        this.#after(this.#rng.between(2, 20) * MIN, () => {
          this.#bottlePresent = true;
          this.#event('bottle_installed', { data: { liters_since_last: round(n.bottleLiters, 1) } });
          n.bottleLiters = 0;
        });
      }
    }
  }

  /** Нужное состояние нагрева/охлаждения: питание, разрешение, расписание (§7.3). */
  #wanted(): { heat: boolean; cool: boolean; allowed: boolean } {
    const n = this.#nvs;
    const allowed = n.powerOn && scheduleAllows(this.#clock.now(), n.energySaving, this.#schedule, n.timezone);
    return { heat: allowed && n.heatEnabled, cool: allowed && n.coolEnabled, allowed };
  }

  /** Плата вычисляет нужное состояние каждую минуту и шлёт AT+PUSH при расхождении с отправленным. */
  #enforce(): void {
    const w = this.#wanted();
    if (w.heat !== this.#target.heat || w.cool !== this.#target.cool) this.#push(w.heat, w.cool);
  }

  /**
   * AT+PUSH: контроллер переключается через время ответа UART. Строки идут по порядку — побеждает последняя
   * отправленная, даже если ответ на неё пришёл раньше.
   */
  #push(heat: boolean, cool: boolean): void {
    const seq = ++this.#pushSeq;
    this.#target = { heat, cool };
    this.#after(this.#rng.between(...this.#cfg.uartMs), () => {
      if (seq < this.#appliedSeq) return;
      this.#appliedSeq = seq;
      this.#ctrl = { heat, cool };
      this.#controllerLoad();
    });
  }

  /** Строка AT+LOAD от контроллера: плата видит состояние и проверяет ожидающие подтверждения (п. 8). */
  #controllerLoad(): void {
    if (this.faults.controllerSilent) return;
    this.#load = { ...this.#ctrl, tHot: this.#tHot, tCold: this.#tCold };
    const now = this.#clock.now();
    const n = this.#nvs;
    n.waiters = n.waiters.filter((w) => {
      if (now > w.deadline) return true; // поздняя строка — не подтверждение; итог даст таймер срока
      if ((w.heat !== undefined && w.heat !== this.#ctrl.heat) || (w.cool !== undefined && w.cool !== this.#ctrl.cool)) return true;
      this.#event('controller_confirmed', {
        data: { cmd_id: w.cmdId, heat_on: this.#ctrl.heat, cool_on: this.#ctrl.cool, uart_ms: Math.round(now - w.t0) },
      });
      return false;
    });
  }

  #filterLeft(): number {
    const n = this.#nvs;
    const days = (this.#clock.now() - n.filterResetAt) / DAY;
    return Math.max(0, Math.floor(Math.min(100 * (1 - n.filterUsed / FILTER_L), 100 * (1 - days / FILTER_DAYS))));
  }

  #checkErrors(): void {
    const n = this.#nvs;
    const now = this.#clock.now();
    const want = new Set<string>();
    // Исчерпание — по самим счётчикам, а не по округлённому проценту кадра.
    if (n.filterUsed >= FILTER_L || now - n.filterResetAt >= FILTER_DAYS * DAY) want.add('B1');
    if ((now - n.lastWaterAt) / DAY > NWU_DAYS) want.add('B2');
    if (this.model.carbonated && this.faults.co2Out) want.add('B3');
    for (const c of want) if (!n.errors.has(c)) { n.errors.add(c); this.#event('error_raised', { code: c }); }
    for (const c of [...n.errors]) if (!want.has(c)) { n.errors.delete(c); this.#event('error_cleared', { code: c }); }
  }

  // ---- сообщения ----

  #frame(cmdId: string | null): Frame {
    const n = this.#nvs;
    const now = this.#clock.now();
    const rsrp = round(this.#baseRsrp + this.#rng.between(-3, 3), 0);
    const f: Frame = {
      v: 0, device_id: this.id, ts: this.#ts(), seq: ++n.seq, cmd_id: cmdId,
      t_hot: round(this.#load.tHot, 1), t_cold: round(this.#load.tCold, 1),
      t_hot_set: this.#tHotSet, t_cold_set: this.#tColdSet,
      heat_on: this.#load.heat, cool_on: this.#load.cool, heat_enabled: n.heatEnabled, cool_enabled: n.coolEnabled,
      power_on: n.powerOn, energy_saving: n.energySaving, water_total_l: n.waterTotal,
      bottle_present: this.model.water_source === 'bottle_top' ? this.#bottlePresent : null,
      uvc_on: this.#uvc, co2_ok: this.model.carbonated ? !this.faults.co2Out : null,
      filter_left_pct: this.#filterLeft(), filter_used_l: n.filterUsed,
      filter_days: Math.floor((now - n.filterResetAt) / DAY), idle_days: Math.floor((now - n.lastWaterAt) / DAY),
      past_state: null, errors: [...n.errors].sort(),
      rssi: rsrp + 20, rsrp, rsrq: round(this.#rng.between(-14, -7), 0), sinr: round(this.#rng.between(0, 20), 0),
      operator: this.#cfg.operator, roaming: false,
      ...(this.#firstFrame ? { fw: this.#cfg.fw, hw: this.#cfg.hw } : {}),
    };
    this.#firstFrame = false;
    this.#queue({ mt: 'frame', body: f });
    return f;
  }

  #event(type: EventType, extra: { code?: string; data?: Record<string, unknown> }): void {
    const e: DeviceEvent = { v: 0, device_id: this.id, seq: ++this.#nvs.seq, ts: this.#ts(), type, ...extra };
    this.#queue({ mt: 'event', body: e });
  }

  /** Кадр или событие: при связи — отправка с подтверждением, без связи — в буфер. */
  #queue(m: Extract<Outgoing, { mt: 'frame' | 'event' }>): void {
    if (this.#link.connected) { this.#sendReliable(m); return; }
    if (m.mt === 'frame') this.#nvs.frames.push(m.body); else this.#nvs.events.push(m.body);
    this.#trim();
  }

  #sendReliable(m: Extract<Outgoing, { mt: 'frame' | 'event' }>): void {
    const seq = m.body.seq;
    const attempt = ++this.#attempt;
    this.#inflight.set(seq, { m, attempt });
    this.#send(m, (ok) => {
      // Ответ относится к этой попытке; более ранняя попытка того же seq (до обрыва) уже возвращена в буфер.
      if (this.#inflight.get(seq)?.attempt !== attempt) return;
      this.#inflight.delete(seq);
      if (ok) return;
      // Не дошло — обратно в буфер, досылка при следующем подключении.
      if (m.mt === 'frame') this.#nvs.frames.push(m.body); else this.#nvs.events.push(m.body);
      this.#nvs.frames.sort((a, b) => a.seq - b.seq);
      this.#nvs.events.sort((a, b) => a.seq - b.seq);
      this.#trim();
    });
  }

  #sendResult(r: Result): void {
    const n = this.#nvs;
    n.unsentResults.add(r.cmd_id);
    this.#send({ mt: 'result', body: r }, (ok) => { if (ok) n.unsentResults.delete(r.cmd_id); });
  }

  #send(m: Outgoing, done?: (ok: boolean) => void): void {
    this.stats.sent[m.mt] = (this.stats.sent[m.mt] ?? 0) + 1;
    this.#link.publish(m, done);
  }

  // ---- команды (§7.3, «Жизненный цикл команды», п. 5, 7, 8) ----

  #onCommand(raw: string): void {
    if (!this.#powered) return;
    let cmd: Partial<Command>;
    try { cmd = JSON.parse(raw) as Partial<Command>; } catch { this.stats.dropped++; return; }
    if (typeof cmd !== 'object' || cmd === null || typeof cmd.cmd_id !== 'string' || !CMD_ID.test(cmd.cmd_id)) {
      this.stats.dropped++; // без cmd_id ответить некуда — только журнал платы
      return;
    }
    const id = cmd.cmd_id;
    const ack = (): void => this.#send({ mt: 'ack', body: { v: 0, cmd_id: id, ack: true } });
    const known = this.#nvs.cmds.get(id);
    if (known) {
      ack();
      if (known.status === 'done' && known.result) this.#sendResult(known.result);
      if (known.status === 'done' && known.frame) this.#send({ mt: 'frame', body: known.frame }); // тот же seq
      return;
    }
    const rec: CmdRecord = { status: 'accepted' };
    this.#remember(id, rec); // до начала исполнения
    ack();
    const err = this.#validate(cmd);
    if (err) return this.#finish(id, rec, { code: 400, message: err });
    if (!this.#synced) return this.#finish(id, rec, { code: 400, message: 'time not synced' });
    const deadline = Date.parse(cmd.deadline_at!);
    if (this.#clock.now() > deadline) return this.#finish(id, rec, { code: 400, message: 'deadline passed' });
    rec.status = 'executing';
    const execMs = cmd.param === 'selftest' ? 3_000 : 20;
    this.#after(execMs, () => this.#execute(cmd as Command, rec, deadline));
  }

  #remember(id: string, rec: CmdRecord): void {
    const m = this.#nvs.cmds;
    m.set(id, rec);
    while (m.size > CMDS_MAX) {
      const oldest = m.keys().next().value!;
      m.delete(oldest);
      this.#nvs.unsentResults.delete(oldest);
    }
  }

  #validate(c: Partial<Command>): string | null {
    if (c.v !== 0) return 'unsupported version';
    if (typeof c.deadline_at !== 'string' || Number.isNaN(Date.parse(c.deadline_at))) return 'bad request';
    const flag = (v: unknown) => v === '0' || v === '1';
    if (c.op === 'GET') {
      if (c.value !== undefined) return 'bad request';
      return ['all', 'schedversion', 'timezone', 'otaallowed'].includes(c.param ?? '') ? null : 'unknown command';
    }
    if (c.op !== 'POST') return 'bad request';
    if (typeof c.value !== 'string') return 'bad request';
    switch (c.param) {
      case 'hottank': case 'coldtank': case 'power': case 'energysaving': case 'otaallowed':
        return flag(c.value) ? null : 'invalid value';
      case 'filterreset': case 'selftest':
        return c.value === '1' ? null : 'invalid value';
      case 'autopowerscheduling':
        return c.value === '' || !('error' in parseSchedule(c.value)) ? null : 'invalid value';
      case 'schedversion':
        return /^[0-9]{1,10},[0-9a-f]{8}$/.test(c.value) ? null : 'invalid value';
      case 'timezone':
        return isTimezone(c.value) ? null : 'invalid value';
      default:
        return 'unknown command';
    }
  }

  #finish(id: string, rec: CmdRecord, r: Omit<Result, 'v' | 'cmd_id'>): void {
    rec.status = 'done';
    rec.result = { v: 0, cmd_id: id, ...r };
    this.#sendResult(rec.result);
  }

  #execute(c: Command, rec: CmdRecord, deadline: number): void {
    if (!this.#powered || rec.status !== 'executing') return;
    if (this.#clock.now() > deadline) return this.#finish(c.cmd_id, rec, { code: 400, message: 'deadline passed' });
    const n = this.#nvs;
    const done = (r: Omit<Result, 'v' | 'cmd_id'> = { code: 200 }) => this.#finish(c.cmd_id, rec, r);
    const v = c.value ?? '';
    if (c.op === 'GET') {
      switch (c.param) {
        case 'all': {
          done();
          rec.frame = this.#frame(c.cmd_id); // внеочередной кадр с cmd_id (п. 6)
          return;
        }
        case 'schedversion':
          return n.scheduleVersion
            ? done({ code: 200, param: 'schedversion', value: n.scheduleVersion })
            : done({ code: 400, message: 'no schedule' });
        case 'timezone': return done({ code: 200, param: 'timezone', value: n.timezone });
        case 'otaallowed': return done({ code: 200, param: 'otaallowed', value: n.otaAllowed ? '1' : '0' });
      }
      return;
    }
    switch (c.param) {
      case 'hottank': case 'coldtank': case 'power': return this.#outputs(c, deadline, done);
      case 'energysaving': n.energySaving = v === '1'; this.#enforce(); return done();
      case 'otaallowed': n.otaAllowed = v === '1'; return done();
      case 'filterreset': {
        // Ресурс по литрам, дням и простою — заново; общий счётчик воды не обнуляется (FW-10).
        const now = this.#clock.now();
        n.filterUsed = 0;
        n.filterResetAt = now;
        n.lastWaterAt = now;
        this.#checkErrors();
        return done();
      }
      case 'timezone': n.timezone = v; this.#enforce(); return done();
      case 'autopowerscheduling': {
        if (this.faults.nvsFail) return done({ code: 400, message: 'schedule save failed' });
        n.schedule = v;
        n.scheduleVersion = isoLocal(this.#clock.now()); // любая запись — сначала локальная версия
        this.#schedule = this.#parsed(v);
        this.#enforce();
        return done();
      }
      case 'schedversion': {
        const [num, crc] = v.split(',') as [string, string];
        if (scheduleCrc(n.timezone, n.schedule) !== crc) return done({ code: 400, message: 'schedule changed' });
        n.scheduleVersion = String(Number(num));
        this.#event('schedule_applied', { data: { version: n.scheduleVersion, source: 'platform' } });
        return done();
      }
      case 'selftest': {
        const checks: Record<string, 'ok' | 'fail'> = {
          controller_link: this.faults.controllerSilent ? 'fail' : 'ok',
          clock: this.#synced ? 'ok' : 'fail',
          nvs: this.faults.nvsFail ? 'fail' : 'ok',
          modem: 'ok',
          signal: this.#baseRsrp > -115 ? 'ok' : 'fail',
          ...(this.model.carbonated ? { co2: this.faults.co2Out ? 'fail' : 'ok' } as const : {}),
        };
        return done({ code: 200, checks });
      }
    }
  }

  /**
   * hottank / coldtank / power (§7.3 п. 8): флаг записан; если включить сейчас нельзя (питание выключено,
   * вне окна, выходной) — flag_only; иначе — pushed: AT+PUSH, если состояние должно измениться, и ожидание
   * свежего AT+LOAD с нужным состоянием до deadline_at → controller_confirmed / controller_not_confirmed.
   */
  #outputs(c: Command, deadline: number, done: (r: Omit<Result, 'v' | 'cmd_id'>) => void): void {
    const n = this.#nvs;
    const on = c.value === '1';
    if (c.param === 'hottank') n.heatEnabled = on;
    else if (c.param === 'coldtank') n.coolEnabled = on;
    else n.powerOn = on;
    const w = this.#wanted();
    const blocked = on && (c.param === 'power' ? !(w.heat || w.cool) : !w.allowed);
    if (blocked) return done({ code: 200, applied: 'flag_only' });
    const t0 = this.#clock.now();
    const change = w.heat !== this.#target.heat || w.cool !== this.#target.cool;
    if (change) this.#push(w.heat, w.cool);
    else this.#after(this.#rng.between(50, 500), () => this.#controllerLoad()); // опрос: состояние уже нужное
    done({ code: 200, applied: 'pushed' });
    const want: Pick<Waiter, 'heat' | 'cool'> =
      c.param === 'hottank' ? { heat: w.heat } : c.param === 'coldtank' ? { cool: w.cool } : { heat: w.heat, cool: w.cool };
    const waiter: Waiter = { cmdId: c.cmd_id, ...want, t0, deadline };
    this.#nvs.waiters.push(waiter);
    this.#watchDeadline(waiter);
  }

  /** К сроку ожидание, не подтверждённое AT+LOAD, кончается событием controller_not_confirmed. */
  #watchDeadline(w: Waiter): void {
    this.#after(Math.max(0, w.deadline - this.#clock.now()) + 1, () => {
      const n = this.#nvs;
      if (!n.waiters.includes(w)) return;
      n.waiters = n.waiters.filter((x) => x !== w);
      this.#event('controller_not_confirmed', { data: { cmd_id: w.cmdId } });
    });
  }

  // ---- служебное ----

  #after(ms: number, fn: () => void): TimerId {
    const id = this.#clock.setTimeout(() => { this.#timers.delete(id); fn(); }, ms);
    this.#timers.set(id, true);
    return id;
  }

  #ts(): string { return new Date(this.#clock.now()).toISOString(); }

  #parsed(s: string): Schedule | null {
    if (!s) return null;
    const p = parseSchedule(s);
    return 'error' in p ? null : p;
  }
}

const isoLocal = (ms: number): string => `local:${isoSeconds(ms)}`;
const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;
