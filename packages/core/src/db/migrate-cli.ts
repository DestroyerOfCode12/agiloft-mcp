import { loadConfig } from '../config.ts';
import { migrateToLatest, openDatabase } from './index.ts';

const config = loadConfig();
const handle = openDatabase(config.DATABASE_URL);
try {
  const applied = await migrateToLatest(handle.db);
  console.log(
    applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is up to date.',
  );
} finally {
  await handle.close();
}
