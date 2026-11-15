import type { NextConfig } from 'next';

// Site de vendas do ConstruBot: só arquivos estáticos (pasta out/), servidos direto pelo Caddy.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default config;
