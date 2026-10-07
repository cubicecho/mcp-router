import { describe, expect, it } from 'vitest';
import { argsFromLines } from '@/lib/arg-lines';

describe('argsFromLines', () => {
  it('reads one argument per line', () => {
    expect(argsFromLines('-y\n@acme/server')).toEqual(['-y', '@acme/server']);
  });

  it('trims each argument and drops blank lines', () => {
    expect(argsFromLines('  --port \n\n   \n8080\t\n')).toEqual(['--port', '8080']);
  });

  it('keeps the spaces inside an argument', () => {
    expect(argsFromLines('--name=my server')).toEqual(['--name=my server']);
  });

  it('reads empty text as no arguments', () => {
    expect(argsFromLines('')).toEqual([]);
  });
});
