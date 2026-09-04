"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A one-line name editor used for creating and renaming feeds, so naming
 * never leaves the sidebar for a browser prompt.
 */
export default function InlineName({
  initial = "",
  placeholder = "Feed name",
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="inline-name"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(event) => setValue(event.target.value)}
      // Clicking elsewhere commits, which is what people expect from an
      // inline field; Escape abandons the edit.
      onBlur={() => onSubmit(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onSubmit(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}
