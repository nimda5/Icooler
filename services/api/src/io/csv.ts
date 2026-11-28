// CSV для импорта и экспорта (V-016): RFC 4180, UTF-8. Разделитель при чтении — запятая или точка с запятой
// (Excel в латышской и русской локали сохраняет «;»), определяется по строке заголовков.

export class CsvError extends Error {
  constructor(message: string, readonly row?: number) { super(message); }
}

export interface CsvRecord { cells: string[]; line: number }

/**
 * Разбор CSV в записи с номером физической строки, где запись начинается (для отчёта: многострочные поля в кавычках
 * сдвигают нумерацию). BOM снимается; CRLF/LF; после закрывающей кавычки — только разделитель или конец записи.
 */
export function parseCsvRecords(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let field = '';
  let state: 'plain' | 'quoted' | 'closed' = 'plain';
  let line = 1;
  let start = 1;
  const endRecord = () => {
    row.push(field); field = '';
    if (row.length > 1 || row[0]!.trim() !== '') records.push({ cells: row, line: start }); // пустые строки — не данные
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (state === 'quoted') {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else state = 'closed';
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === delim) {
      row.push(field); field = ''; state = 'plain';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord(); state = 'plain';
      line++; start = line;
    } else if (state === 'closed') {
      throw new CsvError('после закрывающей кавычки — текст', line);
    } else if (ch === '"') {
      if (field !== '') throw new CsvError('кавычка внутри значения без кавычек', line);
      state = 'quoted';
    } else field += ch;
  }
  if (state === 'quoted') throw new CsvError('незакрытая кавычка', line);
  if (field !== '' || row.length || state === 'closed') endRecord();
  return records;
}

/** Разбор CSV: записи → поля. */
export function parseCsv(input: string): string[][] {
  return parseCsvRecords(input).map((r) => r.cells);
}

/**
 * Значение ячейки для файла, который откроют в Excel: начало с = + - @ (и табуляции/CR) делает из текста формулу —
 * экранируется апострофом (CSV injection).
 */
export function safeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // и значения, уже начинающиеся с апострофов перед ними, — чтобы снятие одного апострофа при загрузке было обратимо
  return /^'*[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Обратное к safeCell: апостроф перед = + - @ (как его ставит выгрузка) снимается — выгрузка загружается без потерь. */
export function unsafeCell(s: string): string {
  return /^''*[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

/** CSV для Excel: BOM (иначе кириллица и латышские буквы ломаются), CRLF, кавычки по необходимости. */
export function toCsv(rows: unknown[][]): Buffer {
  const esc = (v: unknown) => {
    const s = safeCell(v);
    return /[",;\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return Buffer.from(`﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`, 'utf8');
}
