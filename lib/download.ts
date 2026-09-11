/**
 * The link that actually downloads a file.
 *
 * Client-safe on purpose: lib/files.ts pulls in pdf.js, which has no place
 * in the browser bundle just to build a URL.
 */
export function downloadUrlFor(url: string, name?: string) {
  const params = new URLSearchParams({ url });
  if (name) params.set("name", name);
  return `/api/download?${params}`;
}
