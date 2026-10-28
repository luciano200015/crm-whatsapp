/**
 * CSV for spreadsheets (RFC 4180, UTF-8 with BOM so Excel reads accents).
 * Text that a spreadsheet would run as a formula (=, +, -, @, tab or
 * carriage return first) is prefixed with an apostrophe. A plain number
 * such as a phone (+59170000000) is not a formula and stays as it is.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d[\d ]*(\.\d+)?$/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? String(value) : value;
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(csvCell).join(',');
}

export function csvDocument(
  header: string[],
  rows: (string | number | null | undefined)[][],
): string {
  return `\uFEFF${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}\r\n`;
}
