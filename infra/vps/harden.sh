#!/usr/bin/env bash
# Prepara uma VPS Ubuntu/Debian nova: usuário de deploy, firewall (UFW), fail2ban, SSH endurecido,
# atualizações automáticas, Docker e swap. Idempotente. Rode como root:
#   DEPLOY_PUBKEY="ssh-ed25519 AAAA..." ./harden.sh
# ATENÇÃO: confirme que consegue entrar como o usuário de deploy (outra sessão aberta) ANTES de
# desligar o login root/por senha: o script só desliga se DISABLE_PASSWORD_LOGIN=1.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "rode como root"; exit 1; }
DEPLOY_USER="${DEPLOY_USER:-deploy}"
SSH_PORT="${SSH_PORT:-22}"
: "${DEPLOY_PUBKEY:?defina DEPLOY_PUBKEY com a chave pública do deploy}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ufw fail2ban unattended-upgrades ca-certificates curl

# --- usuário de deploy (chave SSH, grupo docker adicionado após instalar o Docker) ---
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
grep -qF "$DEPLOY_PUBKEY" "/home/$DEPLOY_USER/.ssh/authorized_keys" 2>/dev/null || echo "$DEPLOY_PUBKEY" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"; chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

# --- Docker ---
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
usermod -aG docker "$DEPLOY_USER"

# --- firewall: nega tudo que entra, libera SSH, HTTP e HTTPS ---
# O Docker publica portas direto no iptables e ignora o UFW: por isso o Compose de produção só
# publica 80/443 (Caddy) e o WA-AKG em 127.0.0.1. Não publique outras portas sem 127.0.0.1.
ufw default deny incoming
ufw default allow outgoing
ufw limit "${SSH_PORT}/tcp" comment ssh        # limit = freia força bruta
ufw allow 80/tcp comment http
ufw allow 443/tcp comment https
ufw allow 443/udp comment http3
ufw --force enable

# --- fail2ban para SSH ---
cat > /etc/fail2ban/jail.d/sshd.local <<JAIL
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 4
findtime = 10m
bantime = 1h
JAIL
systemctl enable --now fail2ban && systemctl restart fail2ban

# --- SSH ---
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<SSHD
Port ${SSH_PORT}
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 3
X11Forwarding no
$( [ "${DISABLE_PASSWORD_LOGIN:-0}" = 1 ] && printf 'PasswordAuthentication no\nPermitRootLogin no\nKbdInteractiveAuthentication no\n' )
SSHD
sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd

# --- atualizações de segurança automáticas ---
dpkg-reconfigure -f noninteractive unattended-upgrades

# --- swap (rede de segurança para a VPS de 4 GB) ---
SWAP_SCRIPT="$(dirname "$0")/../scripts/setup-swap.sh"
[ -x "$SWAP_SCRIPT" ] && "$SWAP_SCRIPT" 2 || echo "setup-swap.sh não encontrado: rode-o depois"

echo; ufw status verbose; fail2ban-client status sshd || true
