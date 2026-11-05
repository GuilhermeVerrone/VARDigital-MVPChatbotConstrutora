# V2 · 06 — Runbook

Para quem opera a V2 (bot, site, painel, WA-AKG e bancos). Complementa o [runbook do piloto](../05-runbook.md), que continua valendo para o bot, a fila e o WhatsApp. **A parte de implantação na VPS (Compose, Caddy, domínio, TLS, registry) ainda não existe**: ver "Pendente" no fim.

## Apps e variáveis

| App | Porta | Variáveis (obrigatórias em negrito) |
|---|---|---|
| bot | 3100 | ver [`infra/.env.example`](../../infra/.env.example) |
| site | 3200 | **`SITE_DATABASE_URL`**, **`SITE_FORM_SECRET`** (≥ 16), `SITE_WHATSAPP_NUMBER`, `SITE_TRUST_PROXY` |
| painel | 3300 | **`PANEL_DATABASE_URL`**, `PANEL_TRUST_PROXY`, `WA_AKG_BASE_URL`, `WA_AKG_API_KEY`, `WA_AKG_SESSION_ID`, `DEMO_ADMIN_PASSWORD` (só no seed) |

Regras que quebram em produção se esquecidas:

- **Atrás de proxy (Caddy), ligue `SITE_TRUST_PROXY=true` e `PANEL_TRUST_PROXY=true`.** Sem isso todo visitante vira o mesmo IP: o limite de 10 envios/hora do formulário e o de 20 logins/15 min passam a valer para todos juntos (um visitante esgota o limite dos demais). O proxy precisa **anexar** o IP ao `X-Forwarded-For` (o app usa o último item).
- `PANEL_INSECURE_COOKIES` nunca em produção (o cookie de sessão precisa de `Secure`).
- Troque a senha do admin do seed: `DEMO_ADMIN_PASSWORD` antes do primeiro seed, ou altere depois. O padrão (`elevare-demo-2026`) é público no repositório.
- O proxy só pode expor `/webhooks/wa-akg` do bot. `/health/deps` mostra o estado das dependências e não tem login: não publique.
- Site e painel mandam CSP com nonce, HSTS, `frame-ancestors 'none'` e `nosniff` (ver `packages/ui/src/csp.ts`). Ao acrescentar script, fonte ou imagem de terceiros, ajuste a CSP; o e2e (`pnpm test:e2e`) reprova violações no console.

## Backup e restauração do banco

O Postgres do bot guarda tudo: leads, conversas, condições, fluxo publicado, usuários do painel e auditoria. **Contém dados pessoais.**

```bash
cd infra
./scripts/backup-db.sh --encrypt-to <chave-pública-age> --keep 14     # gera backups/bot-AAAAMMDD-HHMMSS.dump.age
```

- Valida o dump com `pg_restore -l` antes de guardá-lo e mantém os `--keep` mais recentes.
- Agende no cron do host (diário, fora do horário comercial), por exemplo `15 3 * * *`.
- **Copie para fora da VPS** (rclone, rsync, bucket). Backup no mesmo disco não protege contra perda da máquina. O script não faz isso.
- Sem `--encrypt-to` o arquivo fica sem cifra (permissão 600) e o script avisa. Gere o par de chaves com `age-keygen`; guarde a chave privada fora da VPS.
- A retenção LGPD vale também para backups: dados apagados pelo titular ou pela retenção continuam nos dumps antigos até eles saírem do `--keep`. Não mantenha dumps além do necessário.

Restaurar (substitui o banco; pare os apps antes):

```bash
docker compose stop bot site painel
./scripts/restore-db.sh backups/bot-....dump.age --yes --identity chave-privada.txt
docker compose up -d bot site painel
```

**Ensaie a restauração** num ambiente descartável antes de precisar dela (foi testada na Fase 16: backup, apagar dados, restaurar, contagem de linhas igual). O WA-AKG tem banco próprio (MySQL com a sessão do WhatsApp): `docker compose exec wa-akg-db mysqldump ...` fica por conta de quem opera; sem ele, uma perda exige ler o QR de novo.

## Demo

- `demo-reset` e o roteiro: [05-roteiro-demo.md](05-roteiro-demo.md). Recusa rodar sem `APP_ENV=demo|development|test`; **nunca defina `APP_ENV` assim no ambiente de produção real**, porque as credenciais do banco são as mesmas.
- Verificação de ponta a ponta antes de apresentar: `pnpm test:e2e` (sobe a própria stack descartável; não toca no seu banco).

## Memória (VPS de 4 GB)

Medição da Fase 16 (detalhes e limites em [fase-16.md](../fases/fase-16.md)): bot ≈ 300 MiB, site ≈ 240 MiB e painel ≈ 400 MiB de pico no macOS sob a carga da demo, somados aos containers medidos na Fase 11b (WA-AKG, MySQL e Postgres do bot, ≈ 530 MiB). Ordem de grandeza: **~1,5 GB de pico**, dentro do teto de 2,5 GB. Ao escrever o Compose do site e do painel use como ponto de partida: painel `mem_limit` 512m, site 384m, `--max-old-space-size` ≈ 70% do limite, e confirme com `infra/scripts/measure-memory.sh`.

## Pendente (não feito na Fase 16, por decisão do usuário)

- Dockerfile e serviço de site e painel no Compose; Caddy, domínio, TLS e registry; swap (`infra/scripts/setup-swap.sh` já existe); `.env` de produção.
- Medição de memória em Docker com a stack completa na VPS.
- Ensaio da demo no ambiente publicado (WhatsApp real e simulador).
- WA-AKG no Compose atual: Swagger ligado com senha, usuário admin e CA de desenvolvimento no `NODE_EXTRA_CA_CERTS`. Desligue o Swagger e use certificado real no ambiente publicado.
