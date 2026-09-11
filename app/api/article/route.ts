import { NextResponse } from "next/server";
import {
  extractArticle,
  articleFromFeedContent,
  preferSyndicated,
  previewFromMetadata,
} from "@/lib/article";
import { SHORT_ARTICLE_WORDS } from "@/lib/paywall";
import { fetchFeedItemContent, unwrapRedirect } from "@/lib/feed";
import { isUnresolvableAggregatorLink } from "@/lib/discover";
import { fileKindFor, fileNameFrom, imageUrlFor, readFileAsArticle } from "@/lib/files";
import { apiKeyFor, apiReaderFor } from "@/lib/apis";
import { readRedditPost, redditPostHtml, redditPostUrl } from "@/lib/reddit";
import { decodeKeysHeader, KEYS_HEADER } from "@/lib/vault";
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

export async function GET(request: Request) {
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

  try {
    let article = await extractArticle(target.toString());

    /**
     * The page answered, but with less than an article. A metered site serves
     * its first few paragraphs to everyone and they extract perfectly, so
     * "it worked" is not the same as "that was all of it" — and where the
     * publisher syndicates the full text in their own feed, that copy is
     * both fuller and freely given. Only fetched when there is a reason to:
     * a normal article never costs the extra request.
     */
    if (feed && (article.partial || article.wordCount < SHORT_ARTICLE_WORDS)) {
      try {
        const content = await fetchFeedItemContent(feed, target.toString());
        if (content) article = preferSyndicated(article, content, title);
      } catch {
        /* the feed could not help; what the page gave still stands */
      }
    }

    return NextResponse.json(article, {
      headers: {
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
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load that article";

    // The site would not give us the page. Many publishers syndicate the full
    // text in their own feed, so use the copy they chose to hand out.
    if (feed) {
      try {
        const content = await fetchFeedItemContent(feed, target.toString());
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
      const preview = await previewFromMetadata(target.toString());
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
          ? "This site doesn't allow reader view, and its feed doesn't carry the full text."
          : message,
      },
      { status: 502 },
    );
  }
}
