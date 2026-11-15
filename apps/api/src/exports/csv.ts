/**
 * CSV that opens cleanly in Excel and Google Sheets: UTF-8 with a BOM,
 * CRLF line ends, quotes where needed, and cells that would start a formula
 * (= + - @, tab, carriage return) prefixed with ' so a name like
 * "=HYPERLINK(...)" stays text.
 */
export type Cell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim()
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
