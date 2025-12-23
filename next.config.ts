import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  // Include only Linux x64 ffmpeg/ffprobe binaries (Vercel uses Linux)
  outputFileTracingIncludes: {
    '/api/transcribe': [
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/ffmpeg-static/index.js',
      './node_modules/ffmpeg-static/package.json',
      './node_modules/ffprobe-static/index.js',
      './node_modules/ffprobe-static/package.json',
      './node_modules/ffprobe-static/bin/linux/x64/ffprobe',
    ],
    '/api/youtube': [
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/ffmpeg-static/index.js',
      './node_modules/ffmpeg-static/package.json',
      './node_modules/ffprobe-static/index.js',
      './node_modules/ffprobe-static/package.json',
      './node_modules/ffprobe-static/bin/linux/x64/ffprobe',
    ],
  },
};

export default nextConfig;
