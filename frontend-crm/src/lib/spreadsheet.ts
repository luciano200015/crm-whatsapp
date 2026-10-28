/**
 * Reads the CSV or Excel (.xlsx) files of «Importar contactos» in the
 * browser, as rows of text, and writes the CSV of the rows that failed.
 */

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024

/** RFC 4180 with the delimiter of the header row (comma, semicolon or tab). */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '')
  const firstLine = source.slice(0, source.search(/\r?\n|$/))
  const delimiter = [',', ';', '\t'].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best,
  )
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"'
        index++
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"' && cell === '') {
      quoted = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return withoutBlankRows(rows)
}

/** The first sheet of an .xlsx, or the rows of a .csv. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser')
    const data = await readSheet(file)
    return withoutBlankRows(data.map((row) => row.map(cellText)))
  }
  return parseCsv(await file.text())
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

function withoutBlankRows(rows: string[][]): string[][] {
  return rows.filter((row) => row.some((cell) => cell.trim() !== ''))
}

const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+-]?\d[\d ]*(\.\d+)?$/

/** CSV for Excel (BOM, CRLF); text that would run as a formula gets an apostrophe. */
export function toCsv(rows: string[][]): string {
  const cell = (value: string) => {
    let text = value
    if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return `﻿${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`
}

/** Saves a Blob as a file. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
