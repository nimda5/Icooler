// AzureMapsGeocoder: запрос, разбор ответа, ошибки и таймаут — без сети (подменённый fetch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AzureMapsGeocoder, NoGeocoder, geocoderFromEnv } from '../src/geocoder.ts';

const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test('запрос: адрес, ключ в заголовке (не в адресе), один результат', async () => {
  let seen: { url: string; key: string | null } | null = null;
  const g = new AzureMapsGeocoder('secret-key', (async (u: URL, init?: RequestInit) => {
    seen = { url: String(u), key: new Headers(init?.headers).get('subscription-key') };
    return new Response(JSON.stringify({ results: [{ position: { lat: 56.95, lon: 24.11 } }] }));
  }) as typeof fetch);
  assert.deepEqual(await g.geocode('Brīvības 1, Rīga'), { lat: 56.95, lng: 24.11 });
  assert.equal(seen!.key, 'secret-key');
  assert.match(seen!.url, /^https:\/\/atlas\.microsoft\.com\/search\/address\/json\?api-version=1\.0&query=Br%C4%AB/);
  assert.doesNotMatch(seen!.url, /secret-key/);
});

test('не нашлось, ошибка сервиса, мусор в ответе, сеть — null (адрес сохраняется без координат)', async () => {
  assert.equal(await new AzureMapsGeocoder('k', respond(200, { results: [] }) as typeof fetch).geocode('x'), null);
  assert.equal(await new AzureMapsGeocoder('k', respond(500, {}) as typeof fetch).geocode('x'), null);
  assert.equal(await new AzureMapsGeocoder('k', respond(200, { results: [{ position: { lat: 'a', lon: 1 } }] }) as typeof fetch).geocode('x'), null);
  assert.equal(await new AzureMapsGeocoder('k', respond(200, { results: [{ position: { lat: 95, lon: 1 } }] }) as typeof fetch).geocode('x'), null);
  assert.equal(await new AzureMapsGeocoder('k', (async () => { throw new Error('ECONNRESET'); }) as typeof fetch).geocode('x'), null);
});

test('таймаут — null, сохранение адреса не ждёт дольше', async () => {
  const slow = ((_u: URL, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch;
  const t0 = Date.now();
  assert.equal(await new AzureMapsGeocoder('k', slow, 50).geocode('x'), null);
  assert.ok(Date.now() - t0 < 1000);
});

test('без ключа — геокодирования нет', async () => {
  assert.ok(geocoderFromEnv({}) instanceof NoGeocoder);
  assert.ok(geocoderFromEnv({ AZURE_MAPS_KEY: 'k' }) instanceof AzureMapsGeocoder);
});
