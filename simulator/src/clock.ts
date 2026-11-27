// Часы симулятора: виртуальные (тесты, ускоренные прогоны) и реальные с множителем скорости.

export type TimerId = number;

export interface Clock {
  /** Время, мс unix. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
}

interface Pending { at: number; order: number; id: TimerId; fn: () => void }

/** Дискретные события: время идёт только в advance*. Порядок равных по времени — по постановке. */
export class VirtualClock implements Clock {
  #now: number;
  #heap: Pending[] = [];
  #cancelled = new Set<TimerId>();
  #next = 1;
  #order = 0;

  constructor(startMs: number) { this.#now = startMs; }

  now(): number { return this.#now; }

  setTimeout(fn: () => void, ms: number): TimerId {
    const id = this.#next++;
    this.#push({ at: this.#now + Math.max(0, ms), order: this.#order++, id, fn });
    return id;
  }

  clearTimeout(id: TimerId): void { this.#cancelled.add(id); }

  /** Прогнать все события до момента now+ms включительно. */
  advanceBy(ms: number): void { this.advanceTo(this.#now + ms); }

  advanceTo(t: number): void {
    for (;;) {
      const top = this.#heap[0];
      if (!top || top.at > t) break;
      this.#pop();
      if (this.#cancelled.delete(top.id)) continue;
      this.#now = top.at;
      top.fn();
    }
    this.#now = Math.max(this.#now, t);
  }

  #less(a: Pending, b: Pending): boolean { return a.at < b.at || (a.at === b.at && a.order < b.order); }

  #push(p: Pending): void {
    const h = this.#heap;
    h.push(p);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.#less(h[i]!, h[parent]!)) break;
      [h[i], h[parent]] = [h[parent]!, h[i]!];
      i = parent;
    }
  }

  #pop(): void {
    const h = this.#heap;
    const last = h.pop()!;
    if (!h.length) return;
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && this.#less(h[l]!, h[m]!)) m = l;
      if (r < h.length && this.#less(h[r]!, h[m]!)) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m]!, h[i]!];
      i = m;
    }
  }
}

/** Реальное время; speed > 1 ускоряет время устройств (только для транспорта memory/jsonl). */
export class RealClock implements Clock {
  readonly #t0: number;
  readonly #r0 = performance.now(); // монотонная основа: перевод системных часов назад не двигает время устройств
  readonly #speed: number;
  #timers = new Map<TimerId, NodeJS.Timeout>();
  #next = 1;

  constructor(speed = 1, startMs = Date.now()) { this.#speed = speed; this.#t0 = startMs; }

  now(): number { return this.#t0 + (performance.now() - this.#r0) * this.#speed; }

  setTimeout(fn: () => void, ms: number): TimerId {
    const id = this.#next++;
    this.#timers.set(id, setTimeout(() => { this.#timers.delete(id); fn(); }, Math.max(0, ms) / this.#speed));
    return id;
  }

  clearTimeout(id: TimerId): void {
    const t = this.#timers.get(id);
    if (t) { clearTimeout(t); this.#timers.delete(id); }
  }
}
