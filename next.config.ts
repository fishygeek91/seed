import type { NextConfig } from "next";

/**
 * STATIC_EXPORT=1 (set by the GitHub Pages deploy workflow) builds the app
 * as a fully static bundle served under the /seed base path. The app is
 * entirely client-side — no server features — so the export is lossless.
 */
const isStaticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: "export" as const,
        basePath: "/seed",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
