import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside the wheredoigo repo; without this Turbopack picks the
  // parent's lockfile as the workspace root.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
