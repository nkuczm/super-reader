import { NextResponse } from "next/server";
import {
  extractArticle,
  articleFromFeedContent,
  previewFromMetadata,
} from "@/lib/article";
import { fetchFeedItemContent, unwrapRedirect } from "@/lib/feed";
import { isUnresolvableAggregatorLink } from "@/lib/discover";
import { fileKindFor, fileNameFrom, imageUrlFor, readFileAsArticle } from "@/lib/files";
import { apiKeyFor, apiReaderFor } from "@/lib/apis";
import { readRedditPost, redditPostHtml, redditPostUrl } from "@/lib/reddit";
import { decodeKeysHeader, KEYS_HEADER } from "@/lib/vault";
import { credentialFor, knownRefusal } from "@/lib/subscriptions";
import { sanitizeArticleHtml } from "@/lib/article";

export const runtime = "nodejs";
// Deliberately not force-dynamic: that disables CDN caching, and an
// extracted article is worth caching between opens.
// Readability on a large page is not instant.
export const maxDuration = 30;

/**
 * This route fetches whatever URL it is handed, so keep it off the private
 * network: without this, anyone could use the deployed app to probe hosts
 * only it can reach.
 */
function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = ipv4.slice(1).map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * How long this function may spend before the platform kills it.
 *
 * Measured on the deployment, 21 Sep 2026: 36 requests in a week ended in
 * `Vercel Runtime Timeout Error: Task timed out after 30 seconds`. The cause
 * is arithmetic, not bad luck. A failing article runs three steps in
 * sequence — extract the page (15s), read the source feed (10s), then fetch
 * the page *again* for its metadata (12s) — which is 37 seconds of budget
 * inside a 30-second function. A timeout bills the whole 30 seconds and
 * returns nothing, so the slowest failures were the most expensive ones.
 *
 * Each step now gets what is actually left, and a step with no room is
 * skipped. The reader gets the same answer sooner, and the function stops
 * being killed mid-sentence.
 */
const BUDGET_MS = 24_000;
/** Below this there is no point starting another fetch. */
const MIN_STEP_MS = 3_000;

export async function GET(request: Request) {
  const startedAt = Date.now();
  const remaining = () => BUDGET_MS - (Date.now() - startedAt);
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  // The source feed, so a syndicated copy can stand in when the site refuses.
  const feed = params.get("feed");
  const title = params.get("title") ?? "";
  if (!url?.trim()) {
    return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  }

  let target: URL;
  try {
    // A wrapped link resolves to the publisher before anything else happens.
    target = new URL(unwrapRedirect(url));
  } catch {
    return NextResponse.json({ error: "That is not a valid URL" }, { status: 400 });
  }
  // Only fetch the public web — never internal addresses or odd schemes.
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return NextResponse.json({ error: "Unsupported URL scheme" }, { status: 400 });
  }
  // ALLOW_PRIVATE_HOSTS exists so local fixtures can be read during testing;
  // it is never set in the deployed app.
  if (process.env.ALLOW_PRIVATE_HOSTS !== "1" && isPrivateHost(target.hostname)) {
    return NextResponse.json({ error: "That host is not reachable" }, { status: 400 });
  }

  if (isUnresolvableAggregatorLink(target.toString())) {
    return NextResponse.json(
      {
        error:
          "Google News hides the publisher behind a link only a browser can follow. Open the original to read it.",
      },
      { status: 502 },
    );
  }

  // A PDF or a text file is read rather than parsed as a page. Handling it
  // here means the reader, the offline download and Saved all treat a file
  // exactly like an article, with no special case of their own.
  const declaredFile = params.get("file");
  if (declaredFile || fileKindFor(target.toString())) {
    try {
      const file = await readFileAsArticle(target.toString(), title);
      return NextResponse.json(file, {
        headers: {
          "cache-control": "public, max-age=3600",
          "CDN-Cache-Control": "public, s-maxage=86400",
          "Vercel-CDN-Cache-Control": "public, s-maxage=86400",
        },
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Could not open that file.",
        },
        { status: 502 },
      );
    }
  }

  // A link that is itself a picture — which is most of what an image-heavy
  // subreddit links — is shown rather than parsed for prose it does not have.
  const picture = imageUrlFor(target.toString());
  if (picture) {
    return NextResponse.json(
      sanitizeArticleHtml(
        `<figure><img src="${picture}" alt="" /></figure>`,
        target.toString(),
        { title: title || fileNameFrom(picture, "Image") },
      ),
      { headers: { "cache-control": "public, max-age=3600" } },
    );
  }

  // A Reddit post is read from Reddit's own feed for it: the comments page
  // refuses reader view and the JSON API 403s a datacenter request, but the
  // per-post .rss carries the post and every reply.
  if (redditPostUrl(target.toString())) {
    try {
      const post = await readRedditPost(target.toString());
      if (post) {
        return NextResponse.json(
          sanitizeArticleHtml(redditPostHtml(post), target.toString(), {
            title: post.title || title || "Reddit post",
            byline: post.author,
            siteName: "Reddit",
            publishedAt: post.publishedAt,
          }),
          { headers: { "cache-control": "public, max-age=300" } },
        );
      }
    } catch {
      /* fall through: the page itself is still worth a try */
    }
  }

  // An article from an API gets its text from that API. Scraping the page is
  // the wrong move where the site serves a stub to anything but a browser.
  const provider = apiReaderFor(target.toString());
  if (provider?.reader) {
    try {
      const keys = decodeKeysHeader(request.headers.get(KEYS_HEADER));
      const read = await provider.reader.read(target.toString(), {
        key: apiKeyFor(provider, keys),
      });
      if (read) {
        return NextResponse.json(
          sanitizeArticleHtml(read.html, target.toString(), {
            title: read.title ?? title ?? provider.name,
            byline: read.byline,
            siteName: provider.name,
            attachments: read.attachments,
          }),
          { headers: { "cache-control": "public, max-age=600" } },
        );
      }
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Could not read that article.",
        },
        { status: 502 },
      );
    }
  }

  /*
   * A subscription the reader stored for this site, decrypted in their
   * browser and sent with this one request. Used for the host it was stored
   * for and no other, and kept nowhere: it exists for the length of the
   * fetch below. See lib/subscriptions.ts.
   */
  const credential = credentialFor(
    target.toString(),
    decodeKeysHeader(request.headers.get(KEYS_HEADER)),
  );

  try {
    const article = await extractArticle(
      target.toString(),
      credential ? { cookie: credential.cookie } : undefined,
    );
    return NextResponse.json(
      credential
        ? {
            ...article,
            subscription: { host: credential.host, applied: !article.paywalled },
          }
        : article,
      {
        headers: credential
          ? {
              /*
               * A page fetched as a signed-in subscriber is that reader's
               * copy, and this deployment is public behind a shared CDN. It
               * must never be stored where the next request could be handed
               * it — that would turn one person's subscription into everyone's.
               */
              "cache-control": "private, no-store",
              "cdn-cache-control": "no-store",
              "vercel-cdn-cache-control": "no-store",
            }
          : {
              // An article's text does not change; let the CDN serve repeat opens
              // instead of re-fetching and re-parsing the page every time.
              // Next strips s-maxage from route handlers, so the CDN lifetime has
              // to be stated in the CDN-specific headers, which it leaves alone.
              "cache-control": "public, max-age=300",
              "cdn-cache-control":
                "public, s-maxage=86400, stale-while-revalidate=604800",
              "vercel-cdn-cache-control":
                "public, s-maxage=86400, stale-while-revalidate=604800",
            },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load that article";

    // The site would not give us the page. Many publishers syndicate the full
    // text in their own feed, so use the copy they chose to hand out.
    if (feed && remaining() > MIN_STEP_MS) {
      try {
        const content = await fetchFeedItemContent(
          feed,
          target.toString(),
          Math.min(10_000, remaining()),
        );
        if (content) {
          return NextResponse.json(
            articleFromFeedContent(content, target.toString(), title),
            { headers: { "cache-control": "public, max-age=300" } },
          );
        }
      } catch {
        /* the feed could not help either */
      }
    }

    // Nothing readable, but nearly every page says something about itself —
    // a title, a picture, a sentence. A video or a gallery has no prose to
    // extract and used to fail outright; this is what every other app shows
    // when it unfurls a link, and it beats an error message.
    try {
      if (remaining() <= MIN_STEP_MS) throw new Error("out of budget");
      const preview = await previewFromMetadata(
        target.toString(),
        Math.min(12_000, remaining()),
      );
      if (preview) {
        return NextResponse.json(preview, {
          headers: { "cache-control": "public, max-age=600" },
        });
      }
    } catch {
      /* the page would not answer at all */
    }

    // Some publishers refuse anything that is not a person in a browser.
    const blocked = /\b(401|403|429|451)\b/.test(message);
    return NextResponse.json(
      {
        error: blocked
          ? // Some sites refuse a server's request outright, before any
            // credential is looked at. Saying "your sign-in expired" there
            // sends the reader off to re-paste a cookie that was never the
            // problem, so a measured refusal is named as what it is.
            (knownRefusal(target.hostname) ??
            (credential
              ? `${credential.host} refused the request even with your saved subscription. The sign-in may have expired — open it on the site, then save a fresh one.`
              : "This site doesn't allow reader view, and its feed doesn't carry the full text."))
          : message,
        ...(credential
          ? { subscription: { host: credential.host, applied: false } }
          : {}),
        ...(knownRefusal(target.hostname) ? { refusesServerFetch: true } : {}),
      },
      {
        status: 502,
        headers: credential
          ? { "cache-control": "private, no-store" }
          : {
              /*
               * A failure is worth caching too. Without this every retry of a
               * dead link is a fresh function invocation doing the same three
               * fetches to reach the same answer — and a list refreshed in
               * two tabs asks twice. Five minutes at the edge absorbs the
               * bursts; short enough that a reader who taps a story again
               * after a site recovers is not told no for long.
               */
              "cache-control": "public, max-age=60",
              "cdn-cache-control": "public, s-maxage=300",
              "vercel-cdn-cache-control": "public, s-maxage=300",
            },
      },
    );
  }
}
