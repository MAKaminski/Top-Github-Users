import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Avatars are the only remote images we render.
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
  // The API routes read the committed snapshot from disk at request time, via
  // `path.join(process.cwd(), "data", ...)`. Tracing currently emits the whole
  // directory on its own, but only as a heuristic for a path it cannot resolve
  // statically; this states the requirement instead of relying on it. Without
  // `data/` beside them the functions build cleanly and then fail on every
  // request. Top-level in Next 16 — it is not an `experimental` key.
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
  },
  experimental: {
    optimizePackageImports: ["motion", "d3-scale", "d3-shape", "d3-array"],
  },
};

export default nextConfig;
