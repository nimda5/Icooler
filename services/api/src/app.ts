// Сборка приложения: NestJS на Fastify (ТЗ §3), префикс /api/v1, cookie, guard и ошибки problem+json.
import 'reflect-metadata';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import type { Config } from './config.ts';
import { Db } from './db/db.service.ts';
import { ApiGuard } from './http/guard.ts';
import { ProblemFilter } from './http/problem.ts';
import { RateLimiter } from './http/rate-limit.ts';
import type { Mailer } from './mail.ts';
import { CONFIG, MAILER } from './tokens.ts';
import { AuthController } from './modules/auth.controller.ts';
import { UsersController } from './modules/users.controller.ts';
import { TenantsController } from './modules/tenants.controller.ts';
import { AuditController } from './modules/audit.controller.ts';
import { SettingsController } from './modules/settings.controller.ts';

export const CONTROLLERS = [AuthController, UsersController, TenantsController, AuditController, SettingsController];

@Module({})
class AppModule {
  static with(cfg: Config, mailer: Mailer, limiter: RateLimiter): DynamicModule {
    return {
      module: AppModule,
      controllers: CONTROLLERS,
      providers: [
        { provide: CONFIG, useValue: cfg },
        { provide: MAILER, useValue: mailer },
        { provide: RateLimiter, useValue: limiter },
        { provide: Db, useFactory: () => new Db(cfg), },
        { provide: APP_GUARD, useClass: ApiGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }
}

export async function createApp(cfg: Config, mailer: Mailer, limiter = new RateLimiter()): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.with(cfg, mailer, limiter),
    new FastifyAdapter({ trustProxy: (_addr: string, hop: number) => hop < cfg.trustProxyHops, bodyLimit: 1024 * 1024 }), { logger: ['error', 'warn'] });
  await app.register(fastifyCookie as never);
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
