import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 启用 Next.js 16 实验性视图过渡支持 */
  experimental: {
    viewTransition: true,
  },
};

export default nextConfig;
