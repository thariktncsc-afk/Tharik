/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The legacy engine is served as classic scripts from /public/js and must not
  // be cached across a rebuild during development.
  async headers() {
    return [
      {
        source: '/js/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
