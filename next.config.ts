import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  // Include ffmpeg/ffprobe binaries in serverless function
  outputFileTracingIncludes: {
    '/api/transcribe': [
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/ffprobe-static/bin/linux/x64/ffprobe',
    ],
    '/api/youtube': [
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/ffprobe-static/bin/linux/x64/ffprobe',
    ],
  },
};

export default nextConfig;

// Note: Vercel has hard limits on request body size for serverless functions
// - Hobby: 4.5MB, Pro: 5MB
// For larger files, consider using Vercel Blob or chunked uploads
