import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { createProviderRegistry } from './providers/catalog-provider.js';
import { createTmdbProvider } from './providers/tmdb.js';
import { createTenraiProvider } from './providers/tenrai.js';
import { createIgdbProvider } from './providers/igdb.js';
import { createOpenLibraryProvider } from './providers/openlibrary.js';
import { openLibraryDatabase } from './db/database.js';
import { openPostgresDatabase } from './db/postgres.js';
import { EntriesRepository } from './modules/entries/entries.repository.js';

export function createRuntime(hosted = false) {
  if (hosted && !env.DATABASE_URL) throw new Error('Set DATABASE_URL to the Supabase transaction pooler connection string in Vercel.');
  if (hosted && env.LIBRA_PASSWORD.length < 16) throw new Error('Set LIBRA_PASSWORD to a private passphrase of at least 16 characters in Vercel.');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const providers = createProviderRegistry([
    createTmdbProvider({ readAccessToken: env.TMDB_READ_ACCESS_TOKEN, apiKey: env.TMDB_API_KEY }),
    createTenraiProvider({ serverKey: env.TENRAI_SERVER_KEY }),
    createIgdbProvider({ clientId: env.IGDB_CLIENT_ID, accessToken: env.IGDB_ACCESS_TOKEN }),
    createOpenLibraryProvider({ contactEmail: env.OPENLIBRARY_CONTACT_EMAIL }),
  ]);
  const database = env.DATABASE_URL ? openPostgresDatabase(env.DATABASE_URL) : null;
  const sqlite = database ? null : openLibraryDatabase(resolve(env.LIBRARY_DB_PATH), resolve(root, 'database/migrations'));
  const repository = new EntriesRepository(database?.store ?? sqlite!);
  const app = createApp(providers, hosted ? undefined : resolve(root, 'client/dist'), repository, {
    password: env.LIBRA_PASSWORD, secure: hosted, backupMaxBytes: hosted ? 4 * 1024 * 1024 : undefined,
  });
  return { app, close: async () => { if (database) await database.close(); else sqlite!.close(); } };
}
