#!/usr/bin/env bash
# Mede a memória da stack com `docker stats` enquanto um comando de carga roda (Fase 11b).
# Registra o pico de cada container e a soma dos picos; falha se passar do teto (padrão 2,5 GB).
#
#   ./scripts/measure-memory.sh [--limit-mb 2560] [--interval 3] -- node scripts/simulate-load.mjs --secret ...
#
# Só conta os containers do projeto (mvp-construtora-*).
# Sem comando depois de `--`, só amostra a stack parada por 30 s (linha de base ociosa).
# Máquina de 4 GB: em Docker Desktop, limite a VM a 4 GB (Settings > Resources) ou use uma VPS de 4 GB.
set -euo pipefail

LIMIT_MB=2560
INTERVAL=3
while [ $# -gt 0 ]; do
  case "$1" in
    --limit-mb) LIMIT_MB="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
done

SAMPLES="$(mktemp)"
trap 'rm -f "${SAMPLES}"' EXIT

sample() {
  # Nome e uso de memória (sem o cache de página: é o "MemUsage" do docker stats).
  docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}' | grep '^mvp-construtora-' | awk -F'|' '{
    split($2, a, " / "); v=a[1]; n=v+0
    if (v ~ /GiB/) n*=1024; else if (v ~ /KiB/) n/=1024; else if (v ~ /MiB/) n=n
    printf "%s %.1f\n", $1, n
  }' >> "${SAMPLES}"
}

if [ $# -gt 0 ]; then
  "$@" &
  LOAD_PID=$!
  while kill -0 "${LOAD_PID}" 2>/dev/null; do sample; sleep "${INTERVAL}"; done
  wait "${LOAD_PID}"
else
  END=$((SECONDS + 30))
  while [ "${SECONDS}" -lt "${END}" ]; do sample; sleep "${INTERVAL}"; done
fi
sample

echo "container                     pico (MiB)  média (MiB)"
awk '{ if ($2 > max[$1]) max[$1]=$2; sum[$1]+=$2; n[$1]++ }
     END { for (c in max) printf "%-28s %9.1f %11.1f\n", c, max[c], sum[c]/n[c] }' "${SAMPLES}" | sort
TOTAL="$(awk '{ if ($2 > max[$1]) max[$1]=$2 } END { for (c in max) t+=max[c]; printf "%.0f", t }' "${SAMPLES}")"
echo "soma dos picos: ${TOTAL} MiB (teto ${LIMIT_MB} MiB)"
[ "${TOTAL}" -le "${LIMIT_MB}" ]
