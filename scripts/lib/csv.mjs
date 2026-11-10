/** Parse an RFC-4180-style CSV record; the Azure files contain no multiline fields. */
export function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (quoted) throw new Error("Unclosed quoted CSV field");
  fields.push(current);
  return fields;
}

export function isoLocalTimestamp(value) {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) throw new Error(`Invalid timestamp format: ${value}`);
  const [, y, mo, d, h, mi, s] = match.map(String);
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() + 1 !== +mo || date.getUTCDate() !== +d || date.getUTCHours() !== +h || date.getUTCMinutes() !== +mi || date.getUTCSeconds() !== +s) {
    throw new Error(`Invalid timestamp value: ${value}`);
  }
  // Data does not specify a time zone. Store normalized naive timestamps without inventing UTC semantics.
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

export function positiveInteger(value, column) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`Invalid ${column}: ${value}`);
  return n;
}

export function nonnegativeInteger(value, column) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid ${column}: ${value}`);
  return n;
}

export function finiteNumber(value, column) {
  if (value.trim() === "") throw new Error(`Missing ${column}`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${column}: ${value}`);
  return n;
}
