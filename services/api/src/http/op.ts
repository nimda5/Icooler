// @Op('operationId') — обработчик операции контракта: метод и путь — из OpenAPI, права — из x-roles.
import { applyDecorators, createParamDecorator, HttpCode, RequestMapping, RequestMethod, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { operation } from '../openapi/spec.ts';
import type { RequestContext } from '../auth/context.ts';

export const OP_KEY = 'icooler:op';

/** status — код успешного ответа из контракта (200, 201, 202, 204). */
export function Op(id: string, status: number) {
  const op = operation(id);
  return applyDecorators(
    SetMetadata(OP_KEY, id),
    RequestMapping({ path: op.route, method: RequestMethod[op.method] }),
    HttpCode(status),
  );
}

/** Контекст запроса: пользователь, арендатор, роль, IP — ставит guard. */
export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext =>
  (ctx.switchToHttp().getRequest() as { icooler: RequestContext }).icooler);
