// Ошибки API — application/problem+json (RFC 9457), как в contracts/openapi.
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

const TITLE: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 410: 'Gone',
  422: 'Unprocessable Content', 423: 'Locked', 428: 'Precondition Required', 429: 'Too Many Requests', 500: 'Internal Server Error',
};

export class Problem extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;
  constructor(status: number, detail?: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    super(detail ?? TITLE[status] ?? 'Error');
    this.status = status;
    this.extra = extra;
    this.headers = headers;
  }
}

export const unauthorized = (d = 'Нет сессии или она истекла') => new Problem(401, d);
export const forbidden = (d = 'Роли это не разрешено') => new Problem(403, d);
export const notFound = (d = 'Нет такого объекта') => new Problem(404, d);
export const conflict = (d: string) => new Problem(409, d);

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status = 500, detail: string | undefined, extra: Record<string, unknown> = {}, headers: Record<string, string> = {};
    if (e instanceof Problem) ({ status, extra, headers } = e), (detail = e.message);
    else if (e instanceof HttpException) { status = e.getStatus(); detail = e.message; }
    else if (isPgError(e) && e.code === '23505') { status = 409; detail = 'Уже существует'; }
    else if (isPgError(e) && (e.code === '23503' || e.code === '42501')) { status = 404; detail = 'Нет такого объекта'; }
    if (status === 500) console.error(e);
    for (const [k, v] of Object.entries(headers)) reply.header(k, v);
    reply.status(status).type('application/problem+json').send({
      type: `https://icooler.local/problems/${status}`, title: TITLE[status] ?? 'Error', status,
      ...(detail && status !== 500 ? { detail } : {}), ...extra,
    });
  }
}

function isPgError(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string';
}
