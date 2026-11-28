import { describe, expect, it } from 'vitest';
import { openDatabase, poolConfig } from '../client.ts';
import { settings } from '../tables/settings.ts';
import { openTestDatabase } from './test-db.ts';

describe('poolConfig', () => {
  it('forces TLS on in production for a host the internet could reach', () => {
    const url = 'postgres://router:pw@db.example.com:5432/router';
    expect(poolConfig(url, { isProduction: true })).toEqual({ connectionString: url, ssl: true });
  });

  it('leaves TLS alone outside production', () => {
    const url = 'postgres://router:pw@db.example.com:5432/router';
    expect(poolConfig(url, { isProduction: false })).toEqual({ connectionString: url });
  });

  it.each([
    'postgres://router:pw@postgres:5432/router',
    'postgres://router:pw@192.168.1.20/router',
    'postgres://router:pw@nas.lan/router',
    'postgres://router:pw@db.example.com/router?sslmode=disable',
  ])('does not force TLS for a private host or an explicit sslmode: %s', (url) => {
    expect(poolConfig(url, { isProduction: true })).toEqual({ connectionString: url });
  });
});

describe('openDatabase', () => {
  it('names where it is without the password, and connects to nothing until the first query', async () => {
    const database = openDatabase('postgres://router:secret@postgres:5432/router', { isProduction: true });
    expect(database.location).toBe('postgres postgres/router');
    expect(database.location).not.toContain('secret');
    await database.close();
  });
});

describe('openTestDatabase', () => {
  it('migrates an in-memory PGlite that the tables can be written to', async () => {
    const database = openTestDatabase();
    await database.ensureSchema();
    await database.db.insert(settings).values({ instanceId: 'kept' });
    const [row] = await database.db.select().from(settings);
    expect(row?.instanceId).toBe('kept');
    await database.close();
  });
});
