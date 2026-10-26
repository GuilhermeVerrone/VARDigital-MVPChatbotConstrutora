#!/usr/bin/env bash
# Gera uma CA de desenvolvimento e um certificado para o bot (hostname "bot" na rede Docker).
# O WA-AKG só entrega webhooks em HTTPS; ele confia nesta CA via NODE_EXTRA_CA_CERTS.
# SOMENTE DESENVOLVIMENTO. Em produção use um domínio público com certificado válido.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "${DIR}"
cd "${DIR}"

if [ -f dev-ca.crt ] && [ -f bot.crt ] && [ "${1:-}" != "--force" ]; then
  echo "Certificados já existem em ${DIR} (use --force para recriar)"
  exit 0
fi

openssl req -x509 -newkey rsa:2048 -nodes -days 825 -sha256 \
  -keyout dev-ca.key -out dev-ca.crt -subj "/CN=mvp-construtora dev CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

openssl req -newkey rsa:2048 -nodes -keyout bot.key -out bot.csr -subj "/CN=bot" 2>/dev/null
cat > bot.ext <<EXT
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:bot,DNS:localhost,IP:127.0.0.1
EXT
openssl x509 -req -in bot.csr -CA dev-ca.crt -CAkey dev-ca.key -CAcreateserial \
  -out bot.crt -days 825 -sha256 -extfile bot.ext 2>/dev/null
rm -f bot.csr bot.ext dev-ca.srl

# Containers rodam como usuário "node"; a chave de dev precisa ser legível no bind mount.
chmod 644 dev-ca.crt bot.crt bot.key
chmod 600 dev-ca.key
openssl verify -CAfile dev-ca.crt bot.crt
echo "Certificados gerados em ${DIR}"
