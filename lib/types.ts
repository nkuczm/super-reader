/**
 * A file a source links rather than writes — the PDF behind a notice, the CSV
 * of the figures. Only formats with text in them; an image is an image.
 */
export type Attachment = {
  url: string;
  kind: "pdf" | "text" | "markdown" | "csv" | "json";
  title?: string;
  bytes?: number;
};

export type Article = {
  id: string;
  title: string;
  link: string;
  author?: string;
  publishedAt?: string;
  summary?: string;
  image?: string;
  attachments?: Attachment[];
  /** Where the discussion of this item lives, when it is not the item itself. */
  comments?: string;
  /**
   * How many comments the source reports, where it reports any. A real RSS
   * extension (slash:comments) that aggregators and blogs do publish, and a
   * direct measure of interest wherever it is available.
   */
  commentCount?: number;
};

export type SourceMeta = {
  feedUrl: string;
  siteUrl: string;
  title: string;
  description?: string;
  favicon: string;
};

export type DiscoverResult = SourceMeta & {
  kind: "feed" | "topic" | "page" | "sitemap" | "x" | "api";
  /** How many articles the source really has, before the preview cap. */
  total: number;
  /** Whether this covers just the pasted section or the whole site. */
  scope: "section" | "site";
  articles: Article[];
};
