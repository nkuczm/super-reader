"use client";

import { useEffect, useState } from "react";

/**
 * Favicon with a letter-avatar fallback, so a site without a favicon (or a
 * blocked icon request) never renders a broken image.
 */
export default function SourceIcon({
  src,
  title,
  size = 17,
}: {
  src: string;
  title: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  // Reset when the source changes so a new icon gets a fresh attempt.
  useEffect(() => setFailed(false), [src]);

  if (failed || !src) {
    return (
      <span
        className="favicon fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
        aria-hidden="true"
      >
        {(title.trim()[0] ?? "?").toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="favicon"
      style={{ width: size, height: size }}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
