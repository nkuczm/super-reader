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
  outputFileTracingIncludes: {
    "/api/article": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  /**
   * Defence in depth for an app whose whole job is injecting other people's
   * HTML into a page.
   *
   * The sanitiser is the actual protection and it is tested, but it is one
   * allowlist standing between a hostile feed and the reader's browser, and a
   * header costs nothing. The point of this policy is the part that would
   * matter if the sanitiser ever let something through:
   *
   *  script-src 'self'   — no script from anywhere else can load, so a
   *                        smuggled <script src> has nowhere to fetch from.
   *  object-src 'none'   — no Flash-era plugin content.
   *  frame-src 'none'    — no embedded frames.
   *  base-uri 'self'     — a smuggled <base> cannot re-point every relative
   *                        URL on the page.
   *  form-action 'self'  — a smuggled form cannot post anywhere else.
   *  frame-ancestors     — this app is never framed, which rules out
   *                        clickjacking someone's feed list.
   *
   * 'unsafe-inline' stays in script-src because Next's App Router ships its
   * hydration payload as inline scripts; removing it needs per-request nonces
   * through middleware. That weakens the script rule against injected inline
   * code — which the sanitiser is what stops — while leaving the external
   * ones, which are what an attacker actually needs, fully in force.
   *
   * img-src and media-src are deliberately wide: article pictures come from
   * whichever CDN the publisher uses, and narrowing that would break the
   * reader rather than protect it.
   */
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: http:",
      "media-src 'self' https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // The app is HTTPS-only in every deployment that matters; a year is
          // the usual floor for being taken seriously by browsers.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
