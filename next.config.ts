import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static finds its binary by path at runtime: keep the package unbundled and ship the binary with every API function
  // (cuts run in after() from the poll, webhook, retry and clip routes).
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
