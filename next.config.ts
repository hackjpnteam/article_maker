import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
};

export default nextConfig;

// Note: Vercel has hard limits on request body size for serverless functions
// - Hobby: 4.5MB, Pro: 5MB
// For larger files, consider using Vercel Blob or chunked uploads
