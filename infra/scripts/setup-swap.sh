#!/usr/bin/env bash
# Cria um swapfile na VPS (Linux, como root). Rede de segurança contra picos de memória, não extensão
# de RAM: com swappiness baixo o kernel só usa o swap quando precisa. Idempotente.
#   sudo ./scripts/setup-swap.sh [tamanho_em_GB]   (padrão: 2)
set -euo pipefail

SIZE_GB="${1:-2}"
FILE=/swapfile

[ "$(uname -s)" = "Linux" ] || { echo "só Linux"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "rode como root (sudo)"; exit 1; }

if swapon --show=NAME --noheadings | grep -qx "${FILE}"; then
  echo "${FILE} já está ativo:"; swapon --show
  exit 0
fi

if [ ! -f "${FILE}" ]; then
  fallocate -l "${SIZE_GB}G" "${FILE}" 2>/dev/null || dd if=/dev/zero of="${FILE}" bs=1M count=$((SIZE_GB * 1024)) status=none
  chmod 600 "${FILE}"
  mkswap "${FILE}" >/dev/null
fi
swapon "${FILE}"

grep -q "^${FILE} " /etc/fstab || echo "${FILE} none swap sw 0 0" >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
sysctl -q -p /etc/sysctl.d/99-swap.conf

echo "swap de ${SIZE_GB} GB ativo:"; swapon --show; free -h
