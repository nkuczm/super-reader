"use client";

import { useState } from "react";
import SourceIcon from "./SourceIcon";
import { hostOf, timeAgo } from "./format";
import type { Article } from "@/lib/types";

type Story = Article & { sourceId: string };
type Source = { title: string; favicon: string; feedUrl: string };

/** Shown before "more" — enough to see who else has it, few enough to stay a row. */
const AT_FIRST = 3;

/**
 * The rest of a story's coverage, beside its lead in Top stories: each
 * outlet's headline, compact, the way Google News puts a story's other
 * sources on the same card (lib/story-groups.ts).
 */
export default function StoryRow({
  stories,
  sourceOf,
  isRead,
  onOpen,
}: {
  stories: Story[];
  sourceOf: (story: Story) => Source | undefined;
  isRead: (story: Story) => boolean;
  onOpen: (story: Story) => void;
}) {
  const [all, setAll] = useState(false);
  const listed = all ? stories : stories.slice(0, AT_FIRST);
  const hidden = stories.length - listed.length;
  return (
    <ul className="story-row">
      {listed.map((story) => {
        const source = sourceOf(story);
        const name = source?.title ?? hostOf(story.link);
        return (
          <li key={story.id} className={isRead(story) ? "read" : undefined}>
            <div className="story-row-meta">
              <SourceIcon src={source?.favicon ?? ""} title={name} size={13} />
              <span className="story-row-name">{name}</span>
              {story.publishedAt && (
                <>
                  <span className="dot">·</span>
                  <span className="story-row-when">{timeAgo(story.publishedAt)}</span>
                </>
              )}
            </div>
            <a
              className="story-row-title"
              href={story.link}
              onClick={(event) => {
                // Plain click reads in-app; modified clicks open the original.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                onOpen(story);
              }}
            >
              {story.title}
            </a>
          </li>
        );
      })}
      {hidden > 0 && (
        <li className="story-row-more">
          <button onClick={() => setAll(true)}>
            {hidden} more on this story
          </button>
        </li>
      )}
    </ul>
  );
}
