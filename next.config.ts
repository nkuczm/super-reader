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
};

export default nextConfig;
