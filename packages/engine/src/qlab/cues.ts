import type { QLabCueInfo } from './types.js';

export function flattenQLabCues(data: unknown, listName = ''): QLabCueInfo[] {
  if (!Array.isArray(data)) return [];
  const cues: QLabCueInfo[] = [];

  for (const item of data) {
    if (typeof item === 'string') {
      cues.push({ uniqueID: item, number: '', name: item, listName });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const cue = item as Record<string, unknown>;
    const number = cue.number === undefined || cue.number === null ? '' : String(cue.number);
    const name = cue.name === undefined || cue.name === null ? '' : String(cue.name);
    const type = cue.type === undefined || cue.type === null ? '' : String(cue.type);
    const uniqueID = typeof cue.uniqueID === 'string' ? cue.uniqueID : undefined;
    const thisList = type.toLowerCase().includes('list') ? name || listName : listName;

    if (number || name || uniqueID) {
      cues.push({ uniqueID, number, name, type, listName: thisList });
    }

    const nested = cue.cues ?? cue.children ?? cue.cuelists;
    if (nested) cues.push(...flattenQLabCues(nested, thisList));
  }

  return cues;
}
