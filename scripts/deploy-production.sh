#!/bin/bash
# Deploy Lar Digital — Sandbox → Produção
# Uso: bash ~/controle-ponto/scripts/deploy-production.sh 2.3.0

set -e

VERSION="$1"
if [ -z "$VERSION" ]; then
  echo "Uso: bash $0 <versão>"
  echo "Exemplo: bash $0 2.3.0"
  exit 1
fi

SANDBOX="/home/claude/controle-ponto-sandbox"
PROD="/home/claude/controle-ponto"
BACKUP_DIR="/home/claude/backups/lardigital"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y%m%d_%H%M)

echo "=========================================="
echo " Lar Digital — Deploy v${VERSION}"
echo " $(date)"
echo "=========================================="
echo ""

# Step 1: Backup production database
echo "[1/7] Backup do banco de produção..."
mkdir -p "$BACKUP_DIR"
if [ -f "$PROD/database.sqlite" ]; then
  cp "$PROD/database.sqlite" "$BACKUP_DIR/database_pre_deploy_${TIMESTAMP}.sqlite"
  echo "  ✅ Backup: $BACKUP_DIR/database_pre_deploy_${TIMESTAMP}.sqlite"
else
  echo "  ⚠️ Banco de produção não encontrado"
fi

# Step 2: Rsync code
echo ""
echo "[2/7] Sincronizando código..."
rsync -av --delete \
  --exclude='database.sqlite' \
  --exclude='database-sandbox.sqlite' \
  --exclude='database-sandbox.sqlite-shm' \
  --exclude='database-sandbox.sqlite-wal' \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='public/uploads' \
  --exclude='.wwebjs_auth' \
  --exclude='.git' \
  --exclude='*.bak*' \
  --exclude='database-backup-*' \
  "$SANDBOX/" "$PROD/" | tail -5
echo "  ✅ Código sincronizado"

# Step 3: Update version.json
echo ""
echo "[3/7] Atualizando versão para v${VERSION}..."
cat > "$PROD/version.json" << EOF
{"version": "${VERSION}", "date": "${DATE}", "env": "producao"}
EOF
echo "  ✅ version.json atualizado"

# Step 4: Install dependencies
echo ""
echo "[4/7] Instalando dependências..."
cd "$PROD" && npm install --production --silent 2>&1 | tail -3
echo "  ✅ npm install concluído"

# Step 5: Restart PM2
echo ""
echo "[5/7] Reiniciando PM2..."
pm2 restart controle-ponto --silent
echo "  ✅ PM2 reiniciado"

# Step 6: Wait for startup
echo ""
echo "[6/7] Aguardando inicialização (5s)..."
sleep 5

# Step 7: Health check
echo ""
echo "[7/7] Health check..."
HEALTH=$(curl -s --max-time 10 http://localhost:3000/api/health 2>/dev/null || echo '{"status":"error"}')
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','error'))" 2>/dev/null || echo "error")

if [ "$STATUS" = "healthy" ]; then
  echo "  ✅ Servidor saudável"
else
  echo "  ⚠️ ATENÇÃO: Health check retornou '$STATUS'"
  echo "  Verifique: pm2 logs controle-ponto --lines 20"
fi

# Summary
echo ""
echo "=========================================="
echo " Deploy concluído!"
echo " Versão: v${VERSION}"
echo " Data: ${DATE}"
echo " Health: ${STATUS}"
echo "=========================================="
echo ""
echo "Verificar: curl -s http://localhost:3000/api/health | python3 -m json.tool"
echo "Logs: pm2 logs controle-ponto --lines 20"
