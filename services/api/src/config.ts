// Настройки сервиса из окружения. Значения по умолчанию ТЗ §7.4 — сроки сессий и лимиты запросов.
export interface Config {
  databaseUrl: string;
  /** Роль, под которую сервис переключается в каждой транзакции (учётная запись службы — её член). */
  dbRole: string;
  /** Ключ HMAC для CSRF-токенов. */
  csrfSecret: string;
  /** Secure у cookie (false — только для локальной разработки по http). */
  cookieSecure: boolean;
  /**
   * Сколько прокси перед сервисом (Application Gateway) — их адреса снимаются с X-Forwarded-For.
   * 0 — заголовок не учитывается: иначе клиент подставит любой IP и обойдёт лимиты.
   */
  trustProxyHops: number;
  /** Адрес порталов для ссылок в письмах. */
  publicUrl: string;
  operatorSessionH: number;
  endUserSessionDays: number;
  invitationH: number;
  passwordResetH: number;
  loginMaxFailures: number;
  loginLockoutMin: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const need = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`не задано ${k}`);
    return v;
  };
  return {
    databaseUrl: need('DATABASE_URL'),
    dbRole: env['DB_ROLE'] ?? 'app_api',
    csrfSecret: need('CSRF_SECRET'),
    cookieSecure: env['COOKIE_SECURE'] !== 'false',
    trustProxyHops: Number(env['TRUST_PROXY_HOPS'] ?? 0),
    publicUrl: env['PUBLIC_URL'] ?? 'https://localhost',
    operatorSessionH: 12,
    endUserSessionDays: 30,
    invitationH: 72,
    passwordResetH: 1,
    loginMaxFailures: 5,
    loginLockoutMin: 15,
  };
}
