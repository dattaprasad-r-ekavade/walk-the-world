/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // DuckDB is a native server dependency used only by the Overture API.
    serverComponentsExternalPackages: ["duckdb"],
  },
};

export default nextConfig;
