// Применить миграции drizzle/ к DATABASE_URL (роль-владелец схемы app).
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export async function migrateDb(url: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env['DATABASE_URL'];
  if (!url) { console.error('DATABASE_URL не задан'); process.exit(2); }
  await migrateDb(url);
  console.log('миграции применены');
}
