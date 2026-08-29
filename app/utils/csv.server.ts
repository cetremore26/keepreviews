/** Escapes a single CSV field per RFC 4180: wrap in quotes and double any
 *  embedded quotes whenever the value contains a comma, quote, or newline. */
export function escapeCsvField(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) =>
    row.map(escapeCsvField).join(","),
  );
  // CRLF is the RFC 4180 line ending and what Excel expects.
  return lines.join("\r\n");
}
