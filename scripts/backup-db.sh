#!/bin/bash
# Backup automatizado do banco de dados Lar Digital
# Uso: bash ~/controle-ponto/scripts/backup-db.sh
# Cron: 0 3 * * * /home/claude/controle-ponto/scripts/backup-db.sh

set -e

APP_DIR="/home/claude/controle-ponto"
BACKUP_DIR="/home/claude/backups/lardigital"
LOG_FILE="$BACKUP_DIR/backup.log"
DB_FILE="$APP_DIR/database.sqlite"
RETENTION_DAYS=30

# Create directories
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M)
BACKUP_FILE="$BACKUP_DIR/database_${TIMESTAMP}.sqlite"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Check DB exists
if [ ! -f "$DB_FILE" ]; then
  log "ERRO: Banco de dados não encontrado em $DB_FILE"
  exit 1
fi

# Copy database (use sqlite3 .backup for consistency)
if command -v sqlite3 &> /dev/null; then
  sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
else
  cp "$DB_FILE" "$BACKUP_FILE"
fi

# Verify backup
if [ -f "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  log "OK: Backup criado: $BACKUP_FILE ($SIZE)"
else
  log "ERRO: Falha ao criar backup"
  exit 1
fi

# Remove backups older than RETENTION_DAYS
DELETED=$(find "$BACKUP_DIR" -name "database_*.sqlite" -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  log "Limpeza: $DELETED backups antigos removidos (> $RETENTION_DAYS dias)"
fi

# Summary
TOTAL=$(ls "$BACKUP_DIR"/database_*.sqlite 2>/dev/null | wc -l)
log "Total de backups: $TOTAL"
