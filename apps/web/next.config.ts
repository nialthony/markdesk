import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@markdesk/core"],
  poweredByHeader: false,
};

export default nextConfig;
