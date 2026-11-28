// CSV и XLSX (V-016) без БД: разбор, экранирование, ZIP/XML книги — читаем собранный файл обратно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateRawSync } from 'node:zlib';
import { CsvError, parseCsv, parseCsvRecords, safeCell, toCsv, unsafeCell } from '../src/io/csv.ts';
import { colName, toXlsx } from '../src/io/xlsx.ts';

/** Минимальный читатель ZIP по центральному каталогу: имя → содержимое, с проверкой CRC. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'нет конца центрального каталога');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), raw = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    assert.equal(buf.readUInt32LE(off), 0x04034b50, `${name}: локальный заголовок`);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const body = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, raw, `${name}: размер`);
    assert.equal(crc32(data), crc, `${name}: CRC`);
    out.set(name, data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** Ячейки листа: ссылка → текст (встроенные строки и числа). */
export function sheetCells(xlsx: Buffer): Map<string, string> {
  const xml = unzip(xlsx).get('xl/worksheets/sheet1.xml')!.toString('utf8');
  const cells = new Map<string, string>();
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>(?:<is><t[^>]*>([\s\S]*?)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g)) {
    cells.set(m[1]!, (m[2] ?? m[3]!).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  }
  return cells;
}

test('CSV: кавычки, переводы строк внутри, CRLF, BOM, пустые строки', () => {
  const text = '﻿a,b,c\r\n"x, y","он сказал ""да""","1\n2"\r\n\r\nz,,\n';
  assert.deepEqual(parseCsv(text), [['a', 'b', 'c'], ['x, y', 'он сказал "да"', '1\n2'], ['z', '', '']]);
});

test('CSV: разделитель «;» (Excel в LV/RU локали) определяется по заголовку', () => {
  assert.deepEqual(parseCsv('device_id;serial\nd-1;"S;1"\n'), [['device_id', 'serial'], ['d-1', 'S;1']]);
});

test('CSV: незакрытая и лишняя кавычка — ошибка со строкой', () => {
  assert.throws(() => parseCsv('a,b\n"x,y\n'), (e: unknown) => e instanceof CsvError && e.row === 3);
  assert.throws(() => parseCsv('a,b\nx"y,1\n'), (e: unknown) => e instanceof CsvError && e.row === 2);
});

test('CSV-инъекция: = + - @ в начале текста — с апострофом; числа — как есть', () => {
  for (const s of ['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)', '\tx']) assert.equal(safeCell(s), `'${s}`);
  assert.equal(safeCell(-5), '-5');
  assert.equal(safeCell('Rīga'), 'Rīga');
  assert.equal(safeCell(null), '');
});

test('CSV выгрузка: BOM, CRLF, кавычки; читается обратно тем же разбором', () => {
  const rows = [['a', 'b'], ['x, "y"', 'Jūras 5;\n2'], ['=1+1', 3]];
  const buf = toCsv(rows);
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(buf.toString('utf8').includes('\r\n'));
  assert.deepEqual(parseCsv(buf.toString('utf8')), [['a', 'b'], ['x, "y"', 'Jūras 5;\n2'], ["'=1+1", '3']]);
});

test('XLSX: обязательные части, CRC, ячейки и заголовок жирным; спецсимволы XML', () => {
  const buf = toXlsx('Devices', [['device_id', 'note', 'n'], ['d-1', 'a < b & "c" Rīga', 42], ['d-2', 'bad\u0001char', null]]);
  const files = unzip(buf);
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(files.has(f), f);
  const cells = sheetCells(buf);
  assert.equal(cells.get('A1'), 'device_id');
  assert.equal(cells.get('B2'), 'a < b & "c" Rīga');
  assert.equal(cells.get('C2'), '42');
  assert.equal(cells.get('B3'), 'badchar'); // недопустимый в XML символ убран
  assert.equal(cells.has('C3'), false); // null — пустая ячейка
  assert.match(files.get('xl/worksheets/sheet1.xml')!.toString(), /<c r="A1" t="inlineStr" s="1">/);
});

test('XLSX: «=» в тексте — строка, а не формула', () => {
  const xml = unzip(toXlsx('S', [['=SUM(A1)']])).get('xl/worksheets/sheet1.xml')!.toString();
  assert.match(xml, /t="inlineStr"[^>]*><is><t xml:space="preserve">=SUM\(A1\)<\/t>/);
  assert.doesNotMatch(xml, /<f>/);
});

test('имена столбцов Excel', () => {
  assert.deepEqual([0, 25, 26, 27, 51, 52, 701, 702].map(colName), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('CSV: после закрывающей кавычки — только разделитель или конец записи', () => {
  assert.throws(() => parseCsv('a,b\n"abc"suffix,1\n'), (e: unknown) => e instanceof CsvError && e.row === 2 && /закрывающей/.test(e.message));
  assert.deepEqual(parseCsv('a,b\n"abc",""\n"x"'), [['a', 'b'], ['abc', ''], ['x']]);
});

test('CSV: номер строки записи — физическая строка начала (многострочные поля, пустые строки)', () => {
  const r = parseCsvRecords('h1,h2\r\n"a\nb\nc",1\r\n\r\nx,2\n"y\n",3');
  assert.deepEqual(r.map((x) => x.line), [1, 2, 6, 7]);
  assert.deepEqual(r[1]!.cells, ['a\nb\nc', '1']);
});

test('экранирование обратимо: выгрузка → разбор → снятие апострофа даёт исходные значения', () => {
  const values = ['-device1', '+SN1', '=note', '@x', "'plain", 'Rīga', "'=already"];
  const back = parseCsv(toCsv([values]).toString('utf8'))[0]!.map(unsafeCell);
  assert.deepEqual(back, values);
});
