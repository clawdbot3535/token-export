// src/timestamp.ts
// Pure helper: a sortable, human-readable filename for snapshot zips.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function timestampedZipName(date: Date): string {
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `tokens-${y}${mo}${d}-${h}${mi}${s}.zip`;
}
