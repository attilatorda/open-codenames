import { describe, expect, it } from 'vitest';
import { csvRecords, parseCsv } from '@shared/csv';

describe('credits.csv parsing', () => {
  it('handles quotes, commas, escaped quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('maps rows to lower-cased headers and skips blank lines', () => {
    const rows = csvRecords('﻿File,Title,Artist,Year\n\nfish.jpg,"The Golden Fish",A. Painter,2001\n');
    expect(rows).toEqual([{ file: 'fish.jpg', title: 'The Golden Fish', artist: 'A. Painter', year: '2001' }]);
  });
});
