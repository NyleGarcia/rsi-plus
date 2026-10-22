/** Save text as a file through a temporary object URL (CSV / JSON exports). */
export function downloadFile(name: string, body: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([body], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** `YYYY-MM-DD` for export file names. */
export const dateStamp = () => new Date().toISOString().slice(0, 10);
