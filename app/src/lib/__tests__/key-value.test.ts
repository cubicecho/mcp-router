import { describe, expect, it } from 'vitest';
import { recordToRows, rowsToRecord } from '@/lib/key-value';

describe('recordToRows', () => {
  it('makes one row per entry, in order', () => {
    expect(recordToRows({ A: '1', B: '' })).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '' },
    ]);
  });
});

describe('rowsToRecord', () => {
  const rows = [
    { key: ' A ', value: ' 1 ' },
    { key: 'B', value: '' },
    { key: '  ', value: 'orphan' },
  ];

  it('trims keys, keeps values as typed and drops rows with no key', () => {
    expect(rowsToRecord(rows)).toEqual({ A: ' 1 ', B: '' });
  });

  it('also drops rows with no value when asked', () => {
    expect(rowsToRecord(rows, { skipEmptyValues: true })).toEqual({ A: ' 1 ' });
  });

  it('lets a later row win a repeated key', () => {
    expect(
      rowsToRecord([
        { key: 'A', value: '1' },
        { key: 'A', value: '2' },
      ]),
    ).toEqual({ A: '2' });
  });
});
