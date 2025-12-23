import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  // Include ffmpeg/ffprobe binaries in serverless function bundle
  outputFileTracingIncludes: {
    '/api/transcribe': [
      './node_modules/ffmpeg-static/**/*',
      './node_modules/ffprobe-static/**/*',
    ],
    '/api/youtube': [
      './node_modules/ffmpeg-static/**/*',
      './node_modules/ffprobe-static/**/*',
    ],
  },
};

export default nextConfig;
