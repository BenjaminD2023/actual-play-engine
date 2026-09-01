import { createActualPlayHandlers } from '@actualplay/next';
import { engine } from '@/lib/engine';

export const { GET, POST, PUT, PATCH, DELETE } = createActualPlayHandlers(engine);
