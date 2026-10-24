import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@duckdb/node-api"], // only used by local scripts, never bundled into routes
  async headers() {
    return [
      {
        source: "/data/baseline/:path*.parquet", // immutable-ish baseline files, rerunning the baseline redeploys them
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" }],
      },
      {
        source: "/duckdb/:path*", // versioned wasm assets copied at install time
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, s-maxage=2592000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
