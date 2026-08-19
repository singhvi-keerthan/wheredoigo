import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // The share view's photos are served by a route, not the filesystem, so the
    // optimizer needs them allowlisted. `search: ""` pins it to query-less
    // paths — which is why /api/go/photo takes its ids as path segments.
    localPatterns: [{ pathname: "/api/go/photo/**", search: "" }],
  },
};

export default nextConfig;
