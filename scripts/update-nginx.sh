#!/bin/bash
# Atualiza configuração Nginx para Lar Digital
# DEVE SER EXECUTADO COMO ROOT: sudo bash ~/controle-ponto/scripts/update-nginx.sh

set -e

NGINX_CONF="/etc/nginx/sites-available/lardigital"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERRO: Execute como root: sudo bash $0"
  exit 1
fi

if [ ! -f "$NGINX_CONF" ]; then
  echo "ERRO: Arquivo de configuração não encontrado: $NGINX_CONF"
  echo "Procurando configurações disponíveis..."
  ls /etc/nginx/sites-available/
  exit 1
fi

# Backup current config
cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%Y%m%d%H%M)"
echo "Backup criado: ${NGINX_CONF}.bak.$(date +%Y%m%d%H%M)"

# Check if gzip is already configured
if grep -q "gzip_types" "$NGINX_CONF"; then
  echo "Gzip já configurado, pulando..."
else
  # Add gzip before the first server block
  sed -i '/server {/i \
    # Gzip compression\
    gzip on;\
    gzip_vary on;\
    gzip_min_length 1024;\
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;\
' "$NGINX_CONF"
  echo "Gzip adicionado"
fi

# Check if security headers exist
if grep -q "X-Frame-Options" "$NGINX_CONF"; then
  echo "Security headers já configurados, pulando..."
else
  # Add security headers inside the first server block
  sed -i '/server {/a \
    # Security headers\
    add_header X-Frame-Options "SAMEORIGIN" always;\
    add_header X-Content-Type-Options "nosniff" always;\
    add_header X-XSS-Protection "1; mode=block" always;\
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;\
' "$NGINX_CONF"
  echo "Security headers adicionados"
fi

# Check if static caching exists
if grep -q "expires 7d" "$NGINX_CONF"; then
  echo "Cache de assets já configurado, pulando..."
else
  sed -i '/server {/a \
    # Static asset caching\
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {\
        expires 7d;\
        add_header Cache-Control "public, immutable";\
    }\
' "$NGINX_CONF"
  echo "Cache de assets estáticos adicionado (7 dias)"
fi

# Test and reload
echo ""
echo "Testando configuração..."
nginx -t

if [ $? -eq 0 ]; then
  echo "Recarregando Nginx..."
  systemctl reload nginx
  echo ""
  echo "✅ Nginx atualizado com sucesso!"
  echo "  - Gzip compression"
  echo "  - Security headers (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection)"
  echo "  - Static asset caching (7 days)"
else
  echo "❌ ERRO na configuração. Restaurando backup..."
  cp "${NGINX_CONF}.bak.$(date +%Y%m%d%H%M)" "$NGINX_CONF"
  echo "Backup restaurado."
  exit 1
fi
