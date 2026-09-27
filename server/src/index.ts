import { resolve } from 'node:path';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { createProviderRegistry } from './providers/catalog-provider.js';
import { createTmdbProvider } from './providers/tmdb.js';
import { createTenraiProvider } from './providers/tenrai.js';
import { createIgdbProvider } from './providers/igdb.js';
import { createOpenLibraryProvider } from './providers/openlibrary.js';
import { openLibraryDatabase } from './db/database.js';
import { EntriesRepository } from './modules/entries/entries.repository.js';

const providers = createProviderRegistry([
  createTmdbProvider({ readAccessToken: env.TMDB_READ_ACCESS_TOKEN, apiKey: env.TMDB_API_KEY }),
  createTenraiProvider({ serverKey: env.TENRAI_SERVER_KEY }),
  createIgdbProvider({ clientId: env.IGDB_CLIENT_ID, accessToken: env.IGDB_ACCESS_TOKEN }),
  createOpenLibraryProvider({ contactEmail: env.OPENLIBRARY_CONTACT_EMAIL }),
]);
const database = openLibraryDatabase(resolve(env.LIBRARY_DB_PATH), resolve(process.cwd(), '../database/migrations'));
const app = createApp(providers, resolve(process.cwd(), '../client/dist'), new EntriesRepository(database));
const server = app.listen(env.PORT, env.HOST, () => {
  console.info('Libra API is running at http://' + env.HOST + ':' + env.PORT);
});
server.on('error', () => {
  console.error('Could not start Libra. Check that the configured host and port are available.');
  database.close();
  process.exit(1);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => { database.close(); process.exit(0); }));
}
