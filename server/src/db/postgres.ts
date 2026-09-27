import postgres from 'postgres';
import { postgresStore } from './store.js';

export function openPostgresDatabase(url: string) {
  // Supabase transaction pooling: one connection per warm function, no prepared statements.
  const sql = postgres(url, { max: 1, prepare: false, ssl: 'require', idle_timeout: 20, connect_timeout: 10 });
  const store = postgresStore(async (work) => {
    const result = await sql.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL search_path TO libra, public');
      // Serialize this personal library across function instances, including import and duplicate saves.
      await transaction.unsafe("SELECT pg_advisory_xact_lock(742019, 1)");
      return { value: await work(async (text, values) => {
        const rows = await transaction.unsafe(text, values as postgres.ParameterOrJSON<never>[]);
        return { rows: [...rows], changes: rows.count };
      }) };
    });
    return result.value;
  });
  return { store, close: () => sql.end({ timeout: 5 }) };
}
