import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { errorHandler } from './middleware/errors.js';
import { createSearchRouter } from './modules/search/search.routes.js';
import type { ProviderRegistry } from './providers/catalog-provider.js';
import { createEntriesRouter } from './modules/entries/entries.routes.js';
import type { EntriesRepository } from './modules/entries/entries.repository.js';
import { HttpError } from './middleware/errors.js';

export function createApp(providers: ProviderRegistry, clientDirectory?: string, entries?: EntriesRepository) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/search', createSearchRouter(providers));
  if (entries) app.use('/api/entries', (req, _res, next) => {
    if (req.headers['sec-fetch-site'] === 'cross-site' && !['GET', 'HEAD'].includes(req.method)) {
      throw new HttpError(403, 'CROSS_SITE_WRITE', 'Open Libra directly to change your library.');
    }
    if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      throw new HttpError(415, 'JSON_REQUIRED', 'Send entry data as JSON.');
    }
    next();
  }, (req, res, next) => {
    const backupRequest = ['/backup/preview', '/backup/import'].includes(req.path);
    express.json({ limit: backupRequest ? '26mb' : '256kb' })(req, res, next);
  }, createEntriesRouter(entries, providers));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
  });

  if (clientDirectory && existsSync(resolve(clientDirectory, 'index.html'))) {
    app.use(express.static(clientDirectory));
    app.get(['/', '/search', '/library', '/entry', '/settings'], (_req, res) => {
      res.sendFile(resolve(clientDirectory, 'index.html'));
    });
  }
  app.use(errorHandler);
  return app;
}
