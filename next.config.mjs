/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // standalone is for Docker/production only — it slows `next dev` on Windows.
  ...(process.env.NODE_ENV === "production" ? { output: "standalone" } : {}),
  experimental: {
    // Keep DuckDB out of the webpack bundle (native module).
    serverComponentsExternalPackages: ["duckdb"],
  },
};

export default nextConfig;
