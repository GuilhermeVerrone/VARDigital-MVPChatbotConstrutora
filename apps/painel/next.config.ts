import type { NextConfig } from 'next';

const config: NextConfig = {
  // Os pacotes do workspace são TypeScript puro (sem build): o Next precisa transpilá-los.
  transpilePackages: ['@mvp/db', '@mvp/simulation', '@mvp/ui'],
  // Módulos nativos / drivers ficam fora do bundle do servidor.
  serverExternalPackages: ['pg', '@prisma/adapter-pg', '@node-rs/argon2'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default config;
