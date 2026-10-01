"use client";

import ErrorScreen from "@/components/ErrorScreen";

/** The last line: an error in the layout itself still gets a screen, not a blank. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <ErrorScreen error={error} retry={retry} />
      </body>
    </html>
  );
}
