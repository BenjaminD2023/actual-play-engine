/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@actualplay/protocol', '@actualplay/vtt'],
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'bcrypt', '@actualplay/engine', '@actualplay/next'],
  },
};
export default config;
