import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // The share view's photos are served by a route, and the map Ask mascot is
    // a fixed public asset. `search: ""` pins both to query-less paths.
    localPatterns: [
      { pathname: "/api/go/photo/**", search: "" },
      { pathname: "/decide-mascot.png", search: "" },
    ],
  },
};

export default nextConfig;
