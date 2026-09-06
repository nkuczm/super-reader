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
};

export default nextConfig;
