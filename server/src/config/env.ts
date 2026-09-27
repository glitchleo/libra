import { config } from 'dotenv';
import { z } from 'zod';

// Workspace scripts run from server/, so .env stays outside Vite's client root.
config({ quiet: true });

const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LIBRARY_DB_PATH: z.string().trim().min(1).default('../database/data/libra.sqlite'),
  DATABASE_URL: z.string().trim().default(''),
  LIBRA_PASSWORD: z.union([z.literal(''), z.string().min(16).max(256)]).default(''),
  TMDB_API_KEY: z.string().trim().default(''),
  TMDB_READ_ACCESS_TOKEN: z.string().trim().default(''),
  IGDB_CLIENT_ID: z.string().trim().default(''),
  IGDB_ACCESS_TOKEN: z.string().trim().default(''),
  TENRAI_SERVER_KEY: z.string().trim().default(''),
  OPENLIBRARY_CONTACT_EMAIL: z.string().trim().pipe(z.union([z.email(), z.literal('')])).default(''),
});

export const env = schema.parse(process.env);
