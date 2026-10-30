/** Synchronous insertion transport only: callers retain normalization, ordering,
 * scope and transaction authority. Unrepresentable/large rows keep old binding. */
export type JsonInsertRow = readonly (string | number)[];
export const JSON_INSERT_MAX_ROWS = 64;
export const JSON_INSERT_MAX_BYTES = 65_536;
export function insertInJsonBatches(rows: Iterable<JsonInsertRow>, batch: (json: string) => void, singleton: (row: JsonInsertRow) => void): void {
  let encoded: string[] = [], bytes = 2;
  const flush = () => {
    if (!encoded.length) return;
    batch('[' + encoded.join(',') + ']');
    encoded = []; bytes = 2;
  };
  for (const row of rows) {
    // Direct SQLite string binding and JSON1 need not agree for lone surrogate
    // or NUL strings. Preserve the original driver's handling rather than fix it.
    const exactJson = row.every(value => typeof value === 'string'
      ? !/[\u0000\uD800-\uDFFF]/u.test(value)
      : Number.isSafeInteger(value) && !Object.is(value, -0));
    if (!exactJson) { flush(); singleton(row); continue; }
    const text = JSON.stringify(row), length = Buffer.byteLength(text, 'utf8');
    if (length + 2 > JSON_INSERT_MAX_BYTES) { flush(); singleton(row); continue; }
    if (encoded.length >= JSON_INSERT_MAX_ROWS || bytes + length + (encoded.length ? 1 : 0) > JSON_INSERT_MAX_BYTES) flush();
    bytes += length + (encoded.length ? 1 : 0); encoded.push(text);
  }
  flush();
}
