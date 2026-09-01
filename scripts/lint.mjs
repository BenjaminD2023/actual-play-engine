import fs from 'node:fs';
import path from 'node:path';

const roots = ['packages', 'apps'];
const banned = /\bTODO\b|\bFIXME\b|coming soon|not implemented/i;
const skip = new Set(['node_modules', 'dist', '.next', 'coverage']);
let failed = false;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8');
      if (banned.test(text) && !full.includes('tests/')) {
        console.error(`lint: banned placeholder in ${full}`);
        failed = true;
      }
    }
  }
}

for (const root of roots) {
  if (fs.existsSync(root)) walk(root);
}
if (failed) process.exit(1);
console.log('lint ok');
