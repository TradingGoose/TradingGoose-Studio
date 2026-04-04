import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    '/**': ['./content/**/*'],
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/index',
        permanent: false,
      },
      {
        source: '/docs/:path*.mdx',
        destination: '/llms.mdx/:path*',
        permanent: true,
      },
    ]
  },
}

export default withMDX(config)
