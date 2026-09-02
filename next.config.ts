import { resolve } from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  turbopack: {
    resolveAlias: {
      "./schema.js": "./src/db/schema.ts",
    },
  },
  webpack(config) {
    config.resolve.alias["./schema.js$"] = resolve("src/db/schema.ts");
    return config;
  },
};

export default nextConfig;
