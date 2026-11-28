// Сессия портала: профиль из GET /me, вход и выход. 401 на запрос текущей сессии — переход на вход.
// Смена сессии (вход, выход, приглашение) увеличивает поколение: кэш очищается, ответы прежней сессии не
// применяются, её поздний 401 не сбрасывает новую.
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api, csrf, ok, onUnauthorized, sessionGen, ApiError, type Schemas } from '../api/client';
import type { Role } from '../api/roles';

export type Profile = Schemas['Profile'];

interface SessionValue {
  profile: Profile | null;
  role: Role | undefined;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  acceptSession(s: Schemas['Session']): Promise<void>;
  logout(all?: boolean): Promise<void>;
  /** Новый профиль — только если сессия та же, что при отправке запроса. */
  setProfile(p: Profile, gen: number): void;
}

const Ctx = createContext<SessionValue | null>(null);
export const PROFILE_KEY = ['profile'] as const;

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: PROFILE_KEY,
    // Отменённый запрос (смена сессии) TanStack Query отбрасывает сам — signal не нужен.
    queryFn: async () => {
      try { return await ok(api.GET('/me')); } catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; }
    },
    retry: false,
    staleTime: Infinity,
  });

  /** Новая сессия или выход: старые запросы отменены, кэш пуст, поколение — следующее. */
  const reset = useCallback(async (profile: Profile | null, token: string | null) => {
    sessionGen.next();
    await qc.cancelQueries();
    qc.clear();
    csrf.set(token);
    qc.setQueryData(PROFILE_KEY, profile);
  }, [qc]);

  useEffect(() => onUnauthorized((gen) => {
    // Только текущая сессия и только если она была: 401 на пробный GET /me публичной страницы — не повод уходить.
    if (gen !== sessionGen.current() || !qc.getQueryData(PROFILE_KEY)) return;
    void reset(null, null).then(() => navigate('/login', { replace: true }));
  }), [reset, navigate, qc]);

  const value = useMemo<SessionValue>(() => ({
    profile: q.data ?? null,
    role: q.data?.role as Role | undefined,
    loading: q.isPending,
    async acceptSession(s) { await reset(s.user, s.csrf_token); },
    async login(email, password) {
      const s = await ok(api.POST('/auth/login', { body: { email, password } }));
      await reset(s.user, s.csrf_token);
    },
    async logout(all = false) {
      try {
        await ok(all ? api.POST('/auth/logout-all') : api.POST('/auth/logout'));
      } catch (e) {
        // 401 — сессии уже нет; иначе (403, 429, сеть) сессия на сервере может быть жива — выход не состоялся.
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      }
      await reset(null, null);
      navigate('/login', { replace: true });
    },
    setProfile(p, gen) { if (gen === sessionGen.current()) qc.setQueryData(PROFILE_KEY, p); },
  }), [q.data, q.isPending, qc, reset, navigate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession вне SessionProvider');
  return v;
}
