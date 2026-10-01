"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-errors";

/**
 * What shows instead of a blank page when the app fails to start or crashes.
 * Says what went wrong, sends it to the log, and offers two ways out: try
 * again, or clear the offline copy of the app itself (never your feeds,
 * notes or saved stories) and reload.
 */
export default function ErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry?: () => void }) {
  useEffect(() => {
    reportClientError(error, "error-boundary");
  }, [error]);

  const clearAppCache = async () => {
    try {
      const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(registrations.map((registration) => registration.unregister()));
      const keys = (await caches?.keys?.()) ?? [];
      await Promise.all(keys.filter((key) => key.startsWith("super-reader-shell")).map((key) => caches.delete(key)));
    } catch {
      /* reload anyway */
    }
    location.reload();
  };

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Super Reader hit a problem</h1>
      <p style={{ margin: "0 0 16px", color: "#71717a" }}>
        It has been reported. Your feeds, notes and saved stories are safe on this device.
      </p>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, background: "#f4f4f5", color: "#18181b", padding: 12, borderRadius: 8, overflowX: "auto" }}>
        {error?.message || String(error)}
      </pre>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <button onClick={() => (retry ? retry() : location.reload())} style={button(true)}>Try again</button>
        <button onClick={() => void clearAppCache()} style={button(false)}>Clear app cache and reload</button>
      </div>
    </div>
  );
}

function button(primary: boolean): React.CSSProperties {
  return {
    padding: "10px 16px", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer",
    border: primary ? "1px solid #2563eb" : "1px solid #d4d4d8",
    background: primary ? "#2563eb" : "#fff", color: primary ? "#fff" : "#18181b",
  };
}
