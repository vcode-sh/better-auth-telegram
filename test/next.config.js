/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 16 uses Turbopack by default
  turbopack: {},
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  webpack: (config, { isServer }) => {
    // Handle .node files (native modules like better-sqlite3)
    config.module.rules.push({
      test: /\.node$/,
      use: "node-loader",
    });

    // Exclude node-only modules from client bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        "better-sqlite3": false,
      };
    }

    return config;
  },
};

module.exports = nextConfig;
