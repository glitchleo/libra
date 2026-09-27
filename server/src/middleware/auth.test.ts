import { describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { createProviderRegistry } from '../providers/catalog-provider.js';
const password = 'a-long-private-test-passphrase';
const makeApp = (secure = false) => createApp(createProviderRegistry([]), undefined, undefined, { password, secure });

describe('personal library access', () => {
  it('protects all library and search endpoints while exposing session status', async () => {
    const api = supertest(makeApp());
    expect((await api.get('/api/auth')).body).toMatchObject({ required: true, authenticated: false });
    for (const path of ['/api/entries', '/api/entries/backup', '/api/entries/index', '/api/search/providers']) await api.get(path).expect(401);
    await api.post('/api/entries').send({}).expect(401);
  });
  it('accepts only the password, persists the session in an HttpOnly cookie and logs out', async () => {
    const agent = supertest.agent(makeApp());
    await agent.post('/api/auth/login').send({ password: 'wrong' }).expect(401);
    const result = await agent.post('/api/auth/login').send({ password }).expect(200);
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(result.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect((await agent.get('/api/auth')).body.authenticated).toBe(true);
    await agent.get('/api/search/providers').expect(200);
    await agent.post('/api/auth/logout').send({}).expect(200);
    await agent.get('/api/search/providers').expect(401);
  });
  it('uses secure cookies in production and rejects tampered or expired cookies', async () => {
    const api = supertest(makeApp(true));
    const result = await api.post('/api/auth/login').send({ password }).expect(200);
    const cookie = result.headers['set-cookie'][0];
    expect(cookie).toContain('Secure');
    await api.get('/api/entries').set('Cookie', cookie.split(';')[0] + 'x').expect(401);
    await api.get('/api/entries').set('Cookie', 'libra_session=1.invalid').expect(401);
  });
  it('rejects cross-site logins and bounds repeated guesses', async () => {
    const api = supertest(makeApp());
    await api.post('/api/auth/login').set('Origin', 'https://unrelated.example').send({ password }).expect(403);
    await api.post('/api/auth/login').set('Sec-Fetch-Site', 'cross-site').send({ password }).expect(403);
    for (let i = 0; i < 10; i++) await api.post('/api/auth/login').send({ password: 'wrong' }).expect(401);
    await api.post('/api/auth/login').send({ password }).expect(429);
  });
  it('preserves password-free local development', async () => {
    const api = supertest(createApp(createProviderRegistry([])));
    expect((await api.get('/api/auth')).body).toMatchObject({ required: false, authenticated: true });
    await api.get('/api/search/providers').expect(200);
  });
});
