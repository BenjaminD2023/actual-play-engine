import type { ActualPlayEngine } from '@actualplay/engine';
import { handleActualPlayRequest } from './router.js';

type RouteContext = { params: { path?: string[] } | Promise<{ path?: string[] }> };

async function resolvePath(context: RouteContext): Promise<string[]> {
  const params = await context.params;
  return params.path ?? [];
}

export function createActualPlayHandlers(engine: ActualPlayEngine) {
  const handler = async (request: Request, context: RouteContext) => {
    const path = await resolvePath(context);
    return handleActualPlayRequest(engine, request, path);
  };

  return {
    GET: handler,
    POST: handler,
    PUT: handler,
    PATCH: handler,
    DELETE: handler,
  };
}
