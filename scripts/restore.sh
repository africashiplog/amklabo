#!/usr/bin/env bash
# Restauration dans une base VIDE (jamais sur la base de production en service).
#   scripts/restore.sh <fichier.dump> <url-base-cible-proprietaire> [archive-fichiers.tar.gz] [dossier-cible-fichiers]
# Après restauration : exécuter « npm run db:migrate » (recrée les droits du rôle applicatif).
set -euo pipefail
DUMP="${1:?fichier .dump requis}"
TARGET="${2:?URL de la base cible requise}"
count=$(psql "$TARGET" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$count" != "0" ]; then
  echo "La base cible n'est pas vide ($count tables) : restauration annulée." >&2
  exit 1
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$TARGET" "$DUMP"
if [ -n "${3:-}" ]; then
  mkdir -p "${4:-./storage}"
  tar -xzf "$3" -C "${4:-./storage}"
fi
echo "Restauration terminée. Lancez maintenant : DATABASE_OWNER_URL=<cible> npm run db:migrate"
