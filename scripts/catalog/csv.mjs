// A small RFC-4180 CSV parser for the drop's exports. Handles quoted fields,
// escaped "" quotes, embedded newlines and commas inside quotes, CRLF or LF, and
// a leading UTF-8 BOM. Returns an array of string[] rows. Deliberately dependency
// -free (this runs in a plain node build script) and forgiving of a trailing
// newline, but strict about quote structure so a malformed export fails loudly
// upstream rather than silently mis-columning.

export function parseCsv(text) {
  let s = String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; sawAny = true; continue; }
    if (c === ',') { row.push(field); field = ''; sawAny = true; continue; }
    if (c === '\r') { continue; } // CRLF: ignore the CR, handle at \n
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; sawAny = false; continue; }
    field += c;
    sawAny = true;
  }
  if (inQuotes) throw new Error('CSV parse error: unterminated quoted field');
  // flush the last field/row if the file did not end with a newline
  if (sawAny || field.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Parse CSV and split header row from data rows, asserting the expected header. */
export function parseCsvWithHeader(text, expectedHeader, sourceName = 'CSV') {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error(`${sourceName}: file is empty`);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const want = expectedHeader.map((h) => h.toLowerCase());
  if (header.length !== want.length || want.some((h, i) => header[i] !== h)) {
    throw new Error(`${sourceName}: unexpected header ${JSON.stringify(rows[0])}; expected ${JSON.stringify(expectedHeader)}`);
  }
  return { header: rows[0], rows: rows.slice(1) };
}
