#!/usr/bin/env bash
# Baixa o WA-AKG numa versão fixa para vendor/wa-akg (ignorado pelo git).
# O código do WA-AKG NÃO é alterado: só é usado como contexto de build do Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="${WA_AKG_REPO:-https://github.com/mrifqidaffaaditya/WA-AKG.git}"
REF="${WA_AKG_REF:-936b26bf7c96bb5776e00224c3803c1bf39c7c71}" # v1.7.0 (2026-10-19)
DEST="${ROOT}/vendor/wa-akg"

if [ -d "${DEST}/.git" ]; then
  CURRENT="$(git -C "${DEST}" rev-parse HEAD)"
  if [ "${CURRENT}" = "${REF}" ]; then
    echo "WA-AKG já está em ${REF} (${DEST})"
    exit 0
  fi
  git -C "${DEST}" fetch --depth 1 origin "${REF}"
else
  mkdir -p "${DEST}"
  git -C "${DEST}" init -q
  git -C "${DEST}" remote add origin "${REPO}"
  git -C "${DEST}" fetch --depth 1 origin "${REF}"
fi
git -C "${DEST}" -c advice.detachedHead=false checkout -q FETCH_HEAD
echo "WA-AKG em $(git -C "${DEST}" rev-parse HEAD) (${DEST})"
