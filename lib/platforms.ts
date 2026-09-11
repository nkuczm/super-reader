/**
 * Hosts where one address is thousands of publications.
 *
 * Discovery's fallbacks are built for a site that belongs to one publisher:
 * if nothing is found under the path that was pasted, widen to the domain and
 * take its feed. On substack.com, medium.com, github.com or youtube.com that
 * is a serious mistake and a silent one. Pasting `substack.com/@platformer`
 * found no feed at `/@platformer/feed`, widened to `substack.com`, and
 * subscribed the reader to Substack's own corporate blog — under the title
 * they pasted, so it looked like it had worked.
 *
 * Two things fix it, and they go together:
 *
 *  1. A multi-tenant host never widens to its own domain feed. On those
 *     hosts, failing to resolve the path is the honest answer.
 *  2. Where the platform's feed address is published and stable, it is used
 *     directly instead of being guessed at. These are documented conventions,
 *     not scraping: `<pub>.substack.com/feed`, `medium.com/feed/@user`,
 *     YouTube's `feeds/videos.xml`, GitHub's `releases.atom`.
 *
 * Resolving a platform URL first is also simply faster — no page fetch, no
 * probing a dozen candidate paths — and more accurate, because these
 * publications routinely declare the platform's site-wide feed in their own
 * <head>, which is how the widening happened in the first place.
 */

export type PlatformFeed = {
  feedUrl: string;
  siteUrl: string;
  title: string;
  /** Host the favicon belongs to. */
  faviconHost: string;
  /** What kind of thing this is, for the note under the preview. */
  note?: string;
};

/**
 * Hosts that carry many unrelated publications. The site-wide fallback is
 * refused on these; nothing else about discovery changes.
 */
const MULTI_TENANT = [
  "substack.com",
  "medium.com",
  "github.com",
  "gitlab.com",
  "youtube.com",
  "youtu.be",
  "wordpress.com",
  "blogspot.com",
  "blogger.com",
  "tumblr.com",
  "beehiiv.com",
  "ghost.io",
  "notion.site",
  "patreon.com",
  "buttondown.com",
  "buttondown.email",
  "bearblog.dev",
  "micro.blog",
  "wixsite.com",
  "squarespace.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "facebook.com",
  "linkedin.com",
  "tiktok.com",
  "threads.net",
  "bsky.app",
];

function hostOf(input: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Is this a host where "the whole site" means something different from what
 * was pasted? A subdomain is the publication's own — `platformer.substack.com`
 * is one publisher and widening to it is right — so only the bare host counts.
 */
export function isMultiTenantHost(input: string) {
  const host = hostOf(input);
  return MULTI_TENANT.includes(host);
}

/**
 * The feed a platform publishes for the thing that was pasted.
 *
 * Only conventions that are documented and stable are here. Anything that
 * would be a guess is left out: a wrong feed that answers 200 is worse than
 * no feed at all, because it looks like it worked.
 */
export function platformFeedFor(input: string): PlatformFeed | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  // ---- Substack ---------------------------------------------------------
  // A publication on substack.com, on its own subdomain, or reached through
  // the reader's open.substack.com links. All three are one publication and
  // all three read from <pub>.substack.com/feed.
  if (host === "open.substack.com" && segments[0] === "pub" && segments[1]) {
    return substack(segments[1]);
  }
  if (host.endsWith(".substack.com")) {
    const name = host.slice(0, -".substack.com".length);
    if (name && name !== "open" && name !== "www") return substack(name);
  }
  if (host === "substack.com") {
    // substack.com/@handle is a writer's profile, not a publication feed, and
    // there is no documented feed address for one. Saying so beats
    // subscribing the reader to Substack's own blog, which is what the
    // site-wide fallback did.
    if (segments[0]?.startsWith("@")) return null;
  }

  // ---- Medium -----------------------------------------------------------
  if (host === "medium.com") {
    if (segments[0]?.startsWith("@") && segments.length <= 2) {
      const handle = segments[0];
      return {
        feedUrl: `https://medium.com/feed/${handle}`,
        siteUrl: `https://medium.com/${handle}`,
        title: `${handle} on Medium`,
        faviconHost: "medium.com",
      };
    }
    // A publication: medium.com/<name>, but not medium.com/<name>/<story>.
    if (segments.length === 1 && !segments[0].includes("-")) {
      return {
        feedUrl: `https://medium.com/feed/${segments[0]}`,
        siteUrl: `https://medium.com/${segments[0]}`,
        title: segments[0],
        faviconHost: "medium.com",
      };
    }
  }
  if (host.endsWith(".medium.com")) {
    const name = host.slice(0, -".medium.com".length);
    if (name && name !== "www") {
      return {
        feedUrl: `https://${name}.medium.com/feed`,
        siteUrl: `https://${name}.medium.com`,
        title: `${name} on Medium`,
        faviconHost: "medium.com",
      };
    }
  }

  // ---- YouTube ----------------------------------------------------------
  // The videos.xml feed is YouTube's own and needs no key. A channel id can
  // be used directly; a playlist likewise. An @handle or a /c/ vanity URL
  // cannot — the id has to be looked up from the page, which discovery's
  // ordinary path does perfectly well by reading the declared feed link.
  if (host === "youtube.com" || host === "m.youtube.com") {
    if (segments[0] === "channel" && segments[1]) {
      return {
        feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${segments[1]}`,
        siteUrl: `https://www.youtube.com/channel/${segments[1]}`,
        title: "YouTube channel",
        faviconHost: "youtube.com",
        note: "YouTube channel",
      };
    }
    if (segments[0] === "playlist") {
      const list = url.searchParams.get("list");
      if (list) {
        return {
          feedUrl: `https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`,
          siteUrl: `https://www.youtube.com/playlist?list=${list}`,
          title: "YouTube playlist",
          faviconHost: "youtube.com",
          note: "YouTube playlist",
        };
      }
    }
  }

  // ---- GitHub -----------------------------------------------------------
  // Releases rather than commits: a release is an announcement with notes,
  // which reads as an article; a commit stream is not something anyone reads
  // in a feed reader.
  if (host === "github.com") {
    const [owner, repo] = segments;
    if (owner && repo && !["settings", "orgs", "sponsors"].includes(owner)) {
      const clean = repo.replace(/\.git$/, "");
      return {
        feedUrl: `https://github.com/${owner}/${clean}/releases.atom`,
        siteUrl: `https://github.com/${owner}/${clean}/releases`,
        title: `${owner}/${clean} releases`,
        faviconHost: "github.com",
        note: "GitHub releases",
      };
    }
  }

  // ---- Tumblr -----------------------------------------------------------
  if (host.endsWith(".tumblr.com")) {
    return {
      feedUrl: `https://${url.hostname}/rss`,
      siteUrl: `https://${url.hostname}`,
      title: url.hostname.replace(/\.tumblr\.com$/, ""),
      faviconHost: "tumblr.com",
    };
  }

  return null;
}

function substack(name: string): PlatformFeed {
  return {
    feedUrl: `https://${name}.substack.com/feed`,
    siteUrl: `https://${name}.substack.com`,
    title: name,
    faviconHost: `${name}.substack.com`,
    note: "Substack",
  };
}
