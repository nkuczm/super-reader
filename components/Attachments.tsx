"use client";

import { useState } from "react";
import type { Attachment } from "@/lib/types";
import { Icon } from "./icons";

type Props = {
  attachments: Attachment[];
  /** Open a file in the full reader, the same way an article opens. */
  onOpen: (file: Attachment) => void;
  isSaved: (url: string) => boolean;
  onToggleSave: (file: Attachment) => void;
};

const LABEL: Record<Attachment["kind"], string> = {
  pdf: "PDF",
  text: "Text",
  markdown: "Markdown",
  csv: "CSV",
  json: "JSON",
};

function size(bytes?: number) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nameOf(file: Attachment) {
  if (file.title) return file.title;
  try {
    const last = decodeURIComponent(
      new URL(file.url).pathname.split("/").filter(Boolean).pop() ?? "",
    );
    return last || LABEL[file.kind];
  } catch {
    return LABEL[file.kind];
  }
}

/**
 * Files a story links, shown the way an image is: a chip you can expand in
 * place. The preview is the file's own first few hundred words, fetched
 * through the same endpoint that reads an article, so opening it fully or
 * saving it needs nothing extra.
 */
export default function Attachments({
  attachments,
  onOpen,
  isSaved,
  onToggleSave,
}: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  async function expand(file: Attachment) {
    if (open === file.url) {
      setOpen(null);
      return;
    }
    setOpen(file.url);
    if (preview[file.url] || error[file.url]) return;

    setLoading(file.url);
    try {
      const params = new URLSearchParams({ url: file.url, file: "1" });
      const res = await fetch(`/api/article?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not open that file.");
      setPreview((current) => ({ ...current, [file.url]: data.html as string }));
    } catch (err) {
      setError((current) => ({
        ...current,
        [file.url]: err instanceof Error ? err.message : "Could not open that file.",
      }));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="files">
      {attachments.map((file) => {
        const expanded = open === file.url;
        return (
          <div className={`file${expanded ? " open" : ""}`} key={file.url}>
            <button
              className="file-chip"
              aria-expanded={expanded}
              onClick={() => expand(file)}
            >
              <span className="file-kind">{LABEL[file.kind]}</span>
              <span className="file-name">{nameOf(file)}</span>
              {size(file.bytes) && <span className="file-size">{size(file.bytes)}</span>}
              <span className={`file-chev${expanded ? " open" : ""}`}>{Icon.chevron}</span>
            </button>

            {expanded && (
              <div className="file-preview">
                {loading === file.url && <span className="spinner" />}
                {error[file.url] && <p className="error">{error[file.url]}</p>}
                {preview[file.url] && (
                  <>
                    <div
                      className="file-text prose"
                      // Server-sanitised, like any other article body.
                      dangerouslySetInnerHTML={{ __html: preview[file.url] }}
                    />
                    <div className="file-actions">
                      <button className="read-btn" onClick={() => onOpen(file)}>
                        {Icon.book} Read it all
                      </button>
                      <button
                        className={`read-btn save-btn${isSaved(file.url) ? " on" : ""}`}
                        aria-pressed={isSaved(file.url)}
                        onClick={() => onToggleSave(file)}
                      >
                        {isSaved(file.url) ? Icon.bookmarkOn : Icon.bookmark}
                        {isSaved(file.url) ? "Saved" : "Save"}
                      </button>
                      <a
                        className="read-btn"
                        href={file.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Open original
                      </a>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
