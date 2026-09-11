import { fileNameFrom } from "@/lib/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hand a linked file to the reader as a download.
 *
 * A plain `<a download>` cannot do this: the attribute is ignored for a
 * cross-origin link, so the browser navigates to the publisher's PDF instead
 * of saving it — which on a phone means landing in whatever viewer the site
 * chooses. Serving the bytes from this origin with an attachment disposition
 * is what makes "Download" mean download.
 *
 * Being a byte-for-byte proxy, this is deliberately narrow:
 *
 *  - the content type is allow-listed and rewritten, never echoed, so this
 *    endpoint cannot be used to serve HTML or script from the app's own
 *    origin;
 *  - the disposition is always `attachment`, so nothing renders in place;
 *  - nosniff, so a browser cannot decide the bytes are something else;
 *  - the size is capped both by the declared length and while streaming, so
 *    a huge or length-less file cannot hold the function open.
 */

/** Types worth handing over, mapped to what we will call them. */
const ALLOWED: Record<string, string> = {
  "application/pdf": "application/pdf",
  "application/x-pdf": "application/pdf",
  "text/plain": "text/plain; charset=utf-8",
  "text/markdown": "text/markdown; charset=utf-8",
  "text/csv": "text/csv; charset=utf-8",
  "text/tab-separated-values": "text/tab-separated-values; charset=utf-8",
  "application/json": "application/json",
  "application/ld+json": "application/json",
};

/** Extensions we will accept when a server declares nothing useful. */
const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  json: "application/json",
};

const MAX_BYTES = 60 * 1024 * 1024;
const TIMEOUT_MS = 25_000;

function extensionOf(url: string) {
  try {
    return new URL(url).pathname.toLowerCase().split(".").pop() ?? "";
  } catch {
    return "";
  }
}

/**
 * A filename a header can carry: no quotes, no newlines, no path. The ASCII
 * fallback is for browsers that ignore the RFC 5987 form.
 */
function dispositionFor(name: string) {
  const clean = name.replace(/[\\/\r\n"]+/g, "_").slice(0, 120) || "download";
  const ascii = clean.replace(/[^\x20-\x7e]+/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("url");
  if (!raw) {
    return Response.json({ error: "Missing ?url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return Response.json({ error: "That is not a URL" }, { status: 400 });
  }
  // Only the public web: no file://, no data:, and nothing that could be used
  // to read something inside the deployment.
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return Response.json({ error: "Only http(s) files can be downloaded" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // The same identification the rest of the app fetches with.
        "user-agent":
          "Mozilla/5.0 (compatible; super-reader/1.0; +https://github.com/nkuczm/super-reader)",
        accept: "*/*",
      },
    });

    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: `The file could not be fetched (${upstream.status})` },
        { status: 502 },
      );
    }

    const declaredType = (upstream.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const type =
      ALLOWED[declaredType] ??
      // Plenty of servers send octet-stream, or nothing, for a PDF.
      BY_EXTENSION[extensionOf(upstream.url || target.toString())];
    if (!type) {
      return Response.json(
        { error: "That is not a file type this can download" },
        { status: 415 },
      );
    }

    const declaredLength = Number(upstream.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BYTES) {
      return Response.json({ error: "That file is too large" }, { status: 413 });
    }

    // Count while streaming: a server that declares no length must not be
    // able to stream forever.
    let seen = 0;
    const capped = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controllerOut) {
          seen += chunk.byteLength;
          if (seen > MAX_BYTES) {
            controllerOut.error(new Error("That file is too large"));
            return;
          }
          controllerOut.enqueue(chunk);
        },
      }),
    );

    const name =
      params.get("name")?.trim() || fileNameFrom(upstream.url || target.toString(), "download");

    return new Response(capped, {
      headers: {
        "content-type": type,
        "content-disposition": dispositionFor(name),
        "x-content-type-options": "nosniff",
        // One reader's download; nothing shared should cache it.
        "cache-control": "private, no-store",
        ...(declaredLength > 0 ? { "content-length": String(declaredLength) } : {}),
      },
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return Response.json(
      { error: aborted ? "The file took too long to fetch" : "The file could not be fetched" },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
