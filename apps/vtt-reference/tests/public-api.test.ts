import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('reference app public API usage', () => {
  it('does not import package internals', () => {
    const root = path.join(import.meta.dirname, '..');
    const files: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', 'data', 'dist'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    }
    walk(root);
    const joined = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(joined).not.toMatch(/@actualplay\/engine\/src\//);
    expect(joined).not.toMatch(/from '@actualplay\/engine\/dist\//);
    expect(joined).toContain('@actualplay/engine');
    expect(joined).toContain('@actualplay/next');
    expect(joined).toContain('@actualplay/vtt');
  });
});
