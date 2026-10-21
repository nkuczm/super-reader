import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  /**
   * pdf.js resolves its worker relative to its own file on disk. Bundled into
   * a server chunk that path no longer exists, and reading a PDF fails with
   * "Setting up fake worker failed"; left external, it is required from
   * node_modules at runtime and resolves normally.
   */
  serverExternalPackages: ["pdfjs-dist"],
  /**
   * ...and the worker has to be traced into the function explicitly. It is
   * only ever imported dynamically, so nothing static points at it and file
   * tracing leaves it out: PDFs then fail in the deployed app while working
   * under `next start`, which has the whole of node_modules on disk.
   */
  /**
   * Basic hardening for every page: never framed by another site (no
   * clickjacking a sign-in or a restore), no MIME sniffing, no full URLs
   * leaked as referrers, and no device features this app never uses.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          /**
           * The parts of a Content-Security-Policy that cannot break a page:
           * no <base> rewriting where links resolve, no plugins, no form
           * posting off-site, and the same no-framing rule for browsers that
           * read CSP rather than X-Frame-Options. Scripts are left alone —
           * Next's inline bootstrap would need nonces on every page.
           */
          {
            key: "Content-Security-Policy",
            value: "base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/api/article": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
