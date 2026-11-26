// "Show the numbers": the scientist's view of a lake or river, every value with its source, and downloads.
// Pure parts are tested in test/sci.test.ts.

export type Row = [label: string, value: string | number | null | undefined, source?: string];

/** CSV with a header; quotes every field that needs it (RFC 4180). */
export function toCSV(header: string[], rows: (string | number | null | undefined)[][]): string {
  const q = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n') + '\n';
}

/** Rows without a value are left out; numbers keep up to 4 significant digits, as in the source files. */
export function cleanRows(rows: Row[]): Row[] {
  return rows.filter((r) => r[1] != null && r[1] !== '' && !(typeof r[1] === 'number' && !Number.isFinite(r[1])))
    .map(([l, v, s]) => [l, typeof v === 'number' ? Number(v.toPrecision(Math.max(4, Math.ceil(Math.log10(Math.abs(v) + 1))))) : v, s]);
}

export function tableHTML(rows: Row[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<table class="sci-t"><tbody>${cleanRows(rows).map(([l, v, s]) => `<tr><th scope="row">${esc(l)}</th><td>${esc(String(v))}</td><td class="src">${esc(s ?? '')}</td></tr>`).join('')}</tbody></table>`;
}

/** Hand the reader a file (no server): a blob URL on a temporary link. */
export function download(name: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const KEY = 'iwa-scientist';
export const scientist = {
  get on(): boolean { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } },
  set on(v: boolean) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode */ } },
};
