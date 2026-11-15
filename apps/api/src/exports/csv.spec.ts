import { csvCell, toCsv } from './csv.js';

describe('csv', () => {
  it('quotes only what needs it', () => {
    expect(csvCell('Omar Siddiqui')).toBe('Omar Siddiqui');
    expect(csvCell('Siddiqui, Omar')).toBe('"Siddiqui, Omar"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded ')).toBe('" padded "');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(null)).toBe('');
  });

  it('keeps text that looks like a formula as text', () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(
      '"\'=HYPERLINK(""http://x"",""click"")"',
    );
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    // Numbers are numbers, even negative ones.
    expect(csvCell(-15)).toBe('-15');
  });

  it('writes a BOM, a header and CRLF lines', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          [1, 'x'],
          [2, null],
        ],
      ),
    ).toBe('﻿a,b\r\n1,x\r\n2,\r\n');
  });
});
