import { describe, expect, it } from 'vitest';
import { isPrivateHost, requiresSsl } from '../ssl.ts';

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'postgres',
    'nas.lan',
    'db.local',
    'pg.home.arpa',
    'db.internal',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.5',
    '172.31.255.1',
    '192.168.1.20',
    '169.254.1.1',
    '::1',
    'fd12::1',
    'fe80::1',
  ])('counts %s as private', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(['db.example.com', '8.8.8.8', '172.32.0.1', '2001:db8::1'])('counts %s as public', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe('requiresSsl', () => {
  it('requires TLS for a public host', () => {
    expect(requiresSsl('postgres://u:p@db.example.com:5432/router')).toBe(true);
    expect(requiresSsl('postgresql://u:p@[2001:db8::1]:5432/router')).toBe(true);
  });

  it('does not for a private host', () => {
    expect(requiresSsl('postgres://u:p@postgres:5432/router')).toBe(false);
    expect(requiresSsl('postgres://u:p@[::1]:5432/router')).toBe(false);
  });

  it('respects an explicit sslmode either way', () => {
    expect(requiresSsl('postgres://u:p@db.example.com/router?sslmode=disable')).toBe(false);
    expect(requiresSsl('postgres://u:p@db.example.com/router?a=1&sslmode=require')).toBe(false);
  });

  it('reads the host, not a lookalike in the credentials', () => {
    expect(requiresSsl('postgres://localhost:pw@db.example.com/router')).toBe(true);
  });
});
