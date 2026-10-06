import { describe, expect, it } from 'vitest';
import { argsTemplate } from '@/lib/args-template';

describe('argsTemplate', () => {
  it('is an empty object for a schema with no properties', () => {
    expect(argsTemplate(undefined)).toBe('{}');
    expect(argsTemplate({ type: 'object', properties: {} })).toBe('{}');
  });

  it('gives each property an empty value of its type', () => {
    const template = argsTemplate({
      properties: {
        text: { type: 'string' },
        count: { type: 'integer' },
        ratio: { type: 'number' },
        flag: { type: 'boolean' },
        items: { type: 'array' },
        options: { type: 'object' },
        untyped: {},
      },
    });
    expect(JSON.parse(template)).toEqual({
      text: '',
      count: 0,
      ratio: 0,
      flag: false,
      items: [],
      options: {},
      untyped: '',
    });
  });

  it('prefers a declared default', () => {
    expect(JSON.parse(argsTemplate({ properties: { limit: { type: 'integer', default: 20 } } }))).toEqual({
      limit: 20,
    });
  });
});
