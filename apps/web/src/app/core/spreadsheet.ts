/**
 * Reading a spreadsheet the admin picked: CSV (from Excel or Google Sheets)
 * or an Excel .xlsx file. The first row holds the column names.
 */
import { unzipSync, strFromU8 } from 'fflate';

export type Field =
  | 'fullName'
  | 'email'
  | 'phone'
  | 'password'
  | 'timezone'
  | 'level'
  | 'curricula'
  | 'hourlyRate'
  | 'zoomLink';

/** Column names people use, English and Arabic, matched loosely. */
const NAMES: Record<Field, string[]> = {
  fullName: [
    'name',
    'full name',
    'fullname',
    'student',
    'student name',
    'teacher',
    'teacher name',
    'الاسم',
    'اسم',
  ],
  email: [
    'email',
    'e-mail',
    'email address',
    'mail',
    'البريد',
    'البريد الالكتروني',
    'الايميل',
    'الإيميل',
    'ايميل',
  ],
  phone: [
    'phone',
    'mobile',
    'whatsapp',
    'phone number',
    'mobile number',
    'رقم',
    'الموبايل',
    'التليفون',
    'الهاتف',
    'رقم الهاتف',
    'واتساب',
  ],
  password: ['password', 'temporary password', 'كلمة السر', 'الباسورد'],
  timezone: [
    'time zone',
    'timezone',
    'tz',
    'city',
    'zone',
    'المنطقة الزمنية',
    'المدينة',
    'التوقيت',
  ],
  level: ['level', 'teacher level', 'tier', 'المستوى'],
  curricula: ['curricula', 'curriculum', 'courses', 'can teach', 'subjects', 'المناهج', 'المنهج'],
  hourlyRate: [
    'hourly rate',
    'rate',
    'rate per hour',
    'pay per hour',
    'hour rate',
    'سعر الساعة',
    'الأجر',
  ],
  zoomLink: ['zoom', 'zoom link', 'class link', 'link', 'meeting link', 'رابط', 'لينك'],
};

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ْ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** Which field each column is, by its header; null for columns we do not use. */
export function mapHeaders(headers: string[]): (Field | null)[] {
  const lookup = new Map<string, Field>();
  for (const [field, names] of Object.entries(NAMES) as [Field, string[]][])
    for (const n of names) lookup.set(key(n), field);
  const used = new Set<Field>();
  return headers.map((h) => {
    const f = lookup.get(key(h)) ?? null;
    if (!f || used.has(f)) return null;
    used.add(f);
    return f;
  });
}

/**
 * Rows of the sheet as objects, skipping empty rows. sheetRows[i] is the row
 * number of records[i] in the sheet (the header is row 1).
 */
export function toRecords(table: string[][]): {
  fields: (Field | null)[];
  records: Partial<Record<Field, string>>[];
  sheetRows: number[];
} {
  const [head = [], ...body] = table;
  const fields = mapHeaders(head);
  const records: Partial<Record<Field, string>>[] = [];
  const sheetRows: number[] = [];
  body.forEach((r, n) => {
    if (!r.some((c) => c.trim())) return;
    const rec: Partial<Record<Field, string>> = {};
    fields.forEach((f, i) => {
      if (f && r[i] !== undefined && r[i].trim()) rec[f] = r[i].trim();
    });
    records.push(rec);
    sheetRows.push(n + 2);
  });
  return { fields, records, sheetRows };
}

/** CSV with quotes, commas or semicolons (Excel in some languages), and a BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : firstLine.includes('\t') && !firstLine.includes(',')
        ? '\t'
        : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** "B12" → 1 (zero-based column) */
function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const textOf = (el: Element | null | undefined) =>
  el ? Array.from(el.getElementsByTagName('t'), (t) => t.textContent ?? '').join('') : '';

/** The first sheet of an .xlsx file, as text cells. */
export function parseXlsx(data: Uint8Array): string[][] {
  const files = unzipSync(data);
  const xml = (path: string) =>
    files[path] ? new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml') : null;

  // The first sheet in the workbook's order.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = xml('xl/workbook.xml');
  const rels = xml('xl/_rels/workbook.xml.rels');
  const firstSheet = workbook?.getElementsByTagName('sheet')[0];
  const relId =
    firstSheet?.getAttribute('r:id') ??
    firstSheet?.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'id',
    );
  const target =
    relId && rels
      ? Array.from(rels.getElementsByTagName('Relationship'))
          .find((r) => r.getAttribute('Id') === relId)
          ?.getAttribute('Target')
      : null;
  if (target)
    sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;

  const shared = Array.from(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') ?? [], (si) =>
    textOf(si),
  );
  const sheet = xml(sheetPath);
  if (!sheet) throw new Error('Could not find a sheet in this file.');

  const rows: string[][] = [];
  for (const r of Array.from(sheet.getElementsByTagName('row'))) {
    const cells: string[] = [];
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r');
      const idx = ref ? columnIndex(ref) : cells.length;
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(c.getElementsByTagName('is')[0]);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else value = v;
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    const rowNum = Number(r.getAttribute('r'));
    // Keep row numbers lined up when the file skips empty rows.
    while (rowNum && rows.length < rowNum - 1) rows.push([]);
    rows.push(cells);
  }
  return rows;
}

export async function readSpreadsheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return parseXlsx(new Uint8Array(await file.arrayBuffer()));
  if (name.endsWith('.xls'))
    throw new Error(
      'This is an old Excel file (.xls). In Excel choose File › Save As › Excel Workbook (.xlsx) or CSV, then pick that file.',
    );
  return parseCsv(await file.text());
}
