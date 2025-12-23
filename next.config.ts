import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  // Include ffmpeg/ffprobe binaries for Vercel (Linux x64 only to stay under 250MB limit)
  // ffmpeg-static: binary is at root, downloaded during npm install for target platform
  // ffprobe-static: binaries stored per platform in bin/ folder
  outputFileTracingIncludes: {
    '/api/transcribe': [
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/ffmpeg-static/index.js',
      './node_modules/ffmpeg-static/package.json',
      './node_modules/ffprobe-static/index.js',
      './node_modules/ffprobe-static/package.json',
      './node_modules/ffprobe-static/bin/linux/x64/**',
    ],
    '/api/youtube': [
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/ffmpeg-static/index.js',
      './node_modules/ffmpeg-static/package.json',
      './node_modules/ffprobe-static/index.js',
      './node_modules/ffprobe-static/package.json',
      './node_modules/ffprobe-static/bin/linux/x64/**',
    ],
  },
};

export default nextConfig;
