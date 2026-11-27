// Пароли (scrypt), токены сессий и одноразовые токены (хранится только sha256), CSRF (HMAC от сессии).
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, len: number, o: ScryptOptions) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, len, o, (e, k) => (e ? rej(e) : res(k))));
const N = 2 ** 15, R = 8, P = 1, LEN = 32, MAXMEM = 64 * 1024 * 1024;
const DUMMY = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(LEN).toString('base64url')}`;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Без хеша (нет учётной записи, пароль не задан) — та же работа, чтобы время ответа её не выдавало. */
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  const [alg, n, r, p, salt, key] = (stored ?? DUMMY).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64url');
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return stored !== null && timingSafeEqual(want, got);
}

export const newToken = (): string => randomBytes(32).toString('base64url');
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const csrfFor = (secret: string, sessionHash: string): string =>
  createHmac('sha256', secret).update(sessionHash).digest('base64url');
export function csrfOk(secret: string, sessionHash: string, token: string | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(csrfFor(secret, sessionHash)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
