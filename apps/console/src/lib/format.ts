/** All timestamps are stored in UTC and displayed in the viewer's locale and time zone. */
const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : dtf.format(d);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map(displayValue).join(', ');
  if (typeof v === 'object') {
    const q = (v as { qbe?: { value?: string } }).qbe;
    if (q?.value) return `→ ${q.value}`;
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${displayValue(x)}`)
      .join(', ');
  }
  return String(v);
}

export const humanize = (s: string) =>
  s.replace(/[_.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
