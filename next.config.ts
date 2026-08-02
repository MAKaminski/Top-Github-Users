import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Avatars are the only remote images we render.
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
  experimental: {
    optimizePackageImports: ["motion", "d3-scale", "d3-shape", "d3-array"],
  },
};

export default nextConfig;
