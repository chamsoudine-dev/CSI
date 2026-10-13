#!/usr/bin/env bash
# ==============================================================================
# Script de sauvegarde automatisée de la base de données PostgreSQL — CSI Niger
# Planifiable via Cron : 0 2 * * * /chemin/vers/csi-niger/scripts/backup.sh >> /var/log/csi-backup.log 2>&1
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${BACKUPS_PATH:-${PROJECT_DIR}/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DATE_TAG="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILE="${BACKUP_DIR}/csi_niger_${DATE_TAG}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -Iseconds)] 📦 Démarrage de la sauvegarde CSI Niger..."

# Si DATABASE_URL est fournie, l'utiliser avec pg_dump
if [ -n "${DATABASE_URL:-}" ]; then
  echo "Sauvegarde via DATABASE_URL..."
  pg_dump "${DATABASE_URL}" | gzip -9 > "${BACKUP_FILE}"
elif docker compose version >/dev/null 2>&1 && docker compose -f "${PROJECT_DIR}/docker-compose.yml" ps --services | grep -q "^db$"; then
  echo "Sauvegarde via Docker Compose (service 'db')..."
  docker compose -f "${PROJECT_DIR}/docker-compose.yml" exec -T db \
    sh -c 'pg_dump -U "${POSTGRES_USER:-csi_user}" -d "${POSTGRES_DB:-csi_niger}"' | gzip -9 > "${BACKUP_FILE}"
elif [ -n "${PGHOST:-}" ] || [ -n "${POSTGRES_HOST:-}" ]; then
  HOST="${PGHOST:-${POSTGRES_HOST:-localhost}}"
  PORT="${PGPORT:-${POSTGRES_PORT:-5432}}"
  USER="${PGUSER:-${POSTGRES_USER:-csi_user}}"
  DB="${PGDATABASE:-${POSTGRES_DB:-csi_niger}}"
  echo "Sauvegarde directe pg_dump vers ${HOST}:${PORT}/${DB}..."
  pg_dump -h "${HOST}" -p "${PORT}" -U "${USER}" -d "${DB}" | gzip -9 > "${BACKUP_FILE}"
else
  echo "Tentative d'exécution pg_dump standard sur la base locale csi_niger..."
  pg_dump -U "${POSTGRES_USER:-csi_user}" "${POSTGRES_DB:-csi_niger}" | gzip -9 > "${BACKUP_FILE}"
fi

FILESIZE="$(du -h "${BACKUP_FILE}" | cut -f1)"
echo "[$(date -Iseconds)] ✅ Sauvegarde terminée : ${BACKUP_FILE} (${FILESIZE})"

# Nettoyage des sauvegardes plus anciennes que la période de rétention
if [ -d "${BACKUP_DIR}" ] && [ "${RETENTION_DAYS}" -gt 0 ]; then
  echo "Nettoyage des sauvegardes plus anciennes que ${RETENTION_DAYS} jours..."
  find "${BACKUP_DIR}" -type f -name "csi_niger_*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete || true
fi

echo "[$(date -Iseconds)] ✨ Opération de sauvegarde achevée avec succès."
