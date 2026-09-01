import fs from 'node:fs';
import path from 'node:path';

export default function globalSetup() {
  const dir = path.join(process.cwd(), 'data');
  for (const name of ['show.db', 'show.db-wal', 'show.db-shm']) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}
