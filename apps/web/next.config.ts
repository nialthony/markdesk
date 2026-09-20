import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@markdesk/core"],
  poweredByHeader: false,
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
