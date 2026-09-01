import type { DurableEvent, TokenRecord } from '@actualplay/protocol';
import type { LiveState } from './model.js';

export function applyReplayEvent(state: LiveState, event: DurableEvent): LiveState {
  const next = structuredClone(state);
  const payload = event.payload;
  if (payload.state && typeof payload.state === 'object' && event.type === 'vtt.checkpoint.restored') {
    return structuredClone(payload.state) as LiveState;
  }
  if (payload.token && typeof payload.token === 'object') {
    const token = payload.token as TokenRecord;
    const index = next.tokens.findIndex((item) => item.id === token.id);
    if (index >= 0) next.tokens[index] = token;
    else next.tokens.push(token);
  }
  if (typeof payload.deleted === 'string') {
    const id = payload.deleted;
    next.tokens = next.tokens.filter((item) => item.id !== id);
    next.walls = next.walls.filter((item) => item.id !== id);
    next.doors = next.doors.filter((item) => item.id !== id);
    next.lights = next.lights.filter((item) => item.id !== id);
    next.annotations = next.annotations.filter((item) => item.id !== id);
    next.templates = next.templates.filter((item) => item.id !== id);
    next.terrain = next.terrain.filter((item) => item.id !== id);
  }
  if (payload.door && typeof payload.door === 'object') {
    const door = payload.door as LiveState['doors'][number];
    const index = next.doors.findIndex((item) => item.id === door.id);
    if (index >= 0) next.doors[index] = door;
    else next.doors.push(door);
  }
  if (payload.wall && typeof payload.wall === 'object') {
    const wall = payload.wall as LiveState['walls'][number];
    const index = next.walls.findIndex((item) => item.id === wall.id);
    if (index >= 0) next.walls[index] = wall;
    else next.walls.push(wall);
  }
  if (Array.isArray(payload.fog)) {
    next.fog = payload.fog as LiveState['fog'];
  }
  if (payload.camera && typeof payload.camera === 'object') {
    next.camera = payload.camera as LiveState['camera'];
  }
  if (typeof payload.announcement === 'string') {
    next.announcement = payload.announcement;
  }
  if (payload.annotation && typeof payload.annotation === 'object') {
    const annotation = payload.annotation as LiveState['annotations'][number];
    next.annotations = [...next.annotations.filter((item) => item.id !== annotation.id), annotation];
  }
  if (payload.template && typeof payload.template === 'object') {
    const template = payload.template as LiveState['templates'][number];
    next.templates = [...next.templates.filter((item) => item.id !== template.id), template];
  }
  if (payload.terrain && typeof payload.terrain === 'object') {
    const terrain = payload.terrain as LiveState['terrain'][number];
    next.terrain = [...next.terrain.filter((item) => item.id !== terrain.id), terrain];
  }
  if (payload.light && typeof payload.light === 'object') {
    const light = payload.light as LiveState['lights'][number];
    next.lights = [...next.lights.filter((item) => item.id !== light.id), light];
  }
  return next;
}

export function categorizeReplay(type: string): string {
  if (type.startsWith('vtt.token')) return 'token';
  if (type.startsWith('vtt.scene')) return 'scene';
  if (type.startsWith('vtt.fog') || type.startsWith('vtt.door') || type.startsWith('vtt.wall') || type.startsWith('vtt.light')) {
    return 'map';
  }
  if (type.includes('combat') || type.includes('initiative')) return 'combat';
  if (type.includes('poll')) return 'poll';
  if (type.includes('handout')) return 'handout';
  if (type.includes('qlab')) return 'qlab';
  if (type.includes('checkpoint') || type.includes('recording')) return 'recovery';
  if (type.includes('announcement') || type.includes('rundown') || type.includes('preset')) return 'show';
  return 'other';
}
