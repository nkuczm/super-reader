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
  kind: "feed" | "topic";
  articles: Article[];
};
