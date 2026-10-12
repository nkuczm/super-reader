/**
 * A bot check standing where the page should be — "Client Challenge",
 * "Just a moment…", "Attention Required!". It answers 200, so nothing else
 * notices; read as an article it becomes a story titled "Client Challenge"
 * and is cached for a day. Measured on sfgate.com, 2 Oct 2026.
 *
 * Kept apart from lib/article.ts so collection can ask the same question
 * without loading a DOM: enrichment read Nature's cookie-check page as an
 * article and gave every Nature story its error icon for a picture
 * (12 Oct 2026).
 */
const CHALLENGE_TITLE =
  /^(client challenge|just a moment\.*|attention required!?.*|access denied|are you a robot\??|pardon our interruption|security check(point)?|vercel security checkpoint|please verify you are a human|human verification|one more step)$/i;
const CHALLENGE_TEXT =
  /(a required part of this site couldn.t load|verify(ing)? (that )?you are (a )?human|enable javascript and cookies to continue|checking (if the site connection is secure|your browser)|press (&|and) hold)/i;

export function isChallengePage(title: string | undefined, text: string): boolean {
  if (title && CHALLENGE_TITLE.test(title.trim())) return true;
  // Only a short page: a real article may quote these words.
  return text.length < 2500 && CHALLENGE_TEXT.test(text);
}

/**
 * The same from a page's raw HTML and where it ended up: a cookie check
 * (nature.com's `?error=cookies_not_supported`), a challenge's own assets, or
 * a page that reads as one.
 */
export function isChallengeHtml(html: string, finalUrl: string): boolean {
  if (/[?&]error=cookies_not_supported\b/.test(finalUrl)) return true;
  if (/\/_fs-ch-[\w-]+\/assets\//.test(html.slice(0, 50_000))) return true;
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return isChallengePage(title, text);
}
