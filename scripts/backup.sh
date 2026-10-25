#!/usr/bin/env bash
# Sauvegarde AMKLABO : base PostgreSQL (format personnalisé, compressé) + fichiers téléversés.
#   BACKUP_DIR (défaut ./backups), BACKUP_KEEP_DAYS (défaut 30), DATABASE_OWNER_URL, UPLOAD_DIR.
# À planifier quotidiennement et à copier HORS du serveur (autre machine, stockage externe).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${DATABASE_OWNER_URL:?DATABASE_OWNER_URL manquant}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
UPLOADS="${UPLOAD_DIR:-./storage/uploads}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

pg_dump --format=custom --no-owner --no-privileges --file "$BACKUP_DIR/amklabo-db-$STAMP.dump" "$DATABASE_OWNER_URL"
tar -czf "$BACKUP_DIR/amklabo-fichiers-$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
# Contrôle d'intégrité minimal : l'archive de la base doit être lisible.
pg_restore --list "$BACKUP_DIR/amklabo-db-$STAMP.dump" > /dev/null
find "$BACKUP_DIR" -name 'amklabo-*' -type f -mtime +"$KEEP" -delete
echo "Sauvegarde terminée : $BACKUP_DIR/amklabo-db-$STAMP.dump et amklabo-fichiers-$STAMP.tar.gz"
