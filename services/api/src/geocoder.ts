// Геокодирование адреса (V-022: «координаты — геокодирование + ручная правка»). Ресурсы — в регионе ЕС (§4.12),
// поэтому — Azure Maps в подписке проекта (ключ — с infra/core, переменная AZURE_MAPS_KEY). Без ключа адрес
// сохраняется без координат: на карте его нет, координаты можно задать вручную.
export interface Point { lat: number; lng: number }

export interface Geocoder {
  /** Координаты адреса или null — не нашлось / сервис недоступен (адрес всё равно сохраняется). */
  geocode(address: string): Promise<Point | null>;
}

export class NoGeocoder implements Geocoder {
  async geocode(): Promise<Point | null> { return null; }
}

/** Azure Maps Search Address (JSON). Таймаут короткий: геокодирование не должно задерживать сохранение адреса. */
export class AzureMapsGeocoder implements Geocoder {
  constructor(
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 3000,
    private readonly base = 'https://atlas.microsoft.com',
  ) {}

  async geocode(address: string): Promise<Point | null> {
    const url = new URL('/search/address/json', this.base);
    url.searchParams.set('api-version', '1.0');
    url.searchParams.set('query', address);
    url.searchParams.set('limit', '1');
    try {
      const r = await this.fetchImpl(url, { headers: { 'subscription-key': this.key }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!r.ok) return null;
      const body = (await r.json()) as { results?: { position?: { lat?: unknown; lon?: unknown } }[] };
      const p = body.results?.[0]?.position;
      const lat = Number(p?.lat), lng = Number(p?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { lat, lng };
    } catch {
      return null; // сеть, таймаут — сохраняем без координат
    }
  }
}

export const GEOCODER = Symbol('GEOCODER');

export function geocoderFromEnv(env: NodeJS.ProcessEnv = process.env): Geocoder {
  return env['AZURE_MAPS_KEY'] ? new AzureMapsGeocoder(env['AZURE_MAPS_KEY']) : new NoGeocoder();
}
