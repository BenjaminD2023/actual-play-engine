import { createActualPlayHandlers } from '@actualplay/next';
import { engine, engineReady } from '@/lib/engine';

const handlers = createActualPlayHandlers(engine);

async function wrap(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  request: Request,
  context: { params: { path?: string[] } | Promise<{ path?: string[] }> }
) {
  await engineReady;
  return handlers[method](request, context);
}

export const GET = (request: Request, context: { params: { path?: string[] } | Promise<{ path?: string[] }> }) =>
  wrap('GET', request, context);
export const POST = (request: Request, context: { params: { path?: string[] } | Promise<{ path?: string[] }> }) =>
  wrap('POST', request, context);
export const PUT = (request: Request, context: { params: { path?: string[] } | Promise<{ path?: string[] }> }) =>
  wrap('PUT', request, context);
export const PATCH = (request: Request, context: { params: { path?: string[] } | Promise<{ path?: string[] }> }) =>
  wrap('PATCH', request, context);
export const DELETE = (request: Request, context: { params: { path?: string[] } | Promise<{ path?: string[] }> }) =>
  wrap('DELETE', request, context);
