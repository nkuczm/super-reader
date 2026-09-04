export type Article = {
  id: string;
  title: string;
  link: string;
  author?: string;
  publishedAt?: string;
  summary?: string;
  image?: string;
};

export type SourceMeta = {
  feedUrl: string;
  siteUrl: string;
  title: string;
  description?: string;
  favicon: string;
};

export type DiscoverResult = SourceMeta & {
  kind: "feed" | "topic" | "page" | "x";
  /** How many articles the source really has, before the preview cap. */
  total: number;
  /** Whether this covers just the pasted section or the whole site. */
  scope: "section" | "site";
  articles: Article[];
};
