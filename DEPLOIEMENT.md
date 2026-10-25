# Déploiement et exploitation — AMKLABO

Ce guide décrit une mise en production sur un serveur Linux (VPS) avec Docker. Les commandes ci-dessous ont été exécutées de bout en bout sur une base vide lors de la validation (Phase 5) : migrations, données initiales, création d'un administrateur, démarrage, contrôle de santé, sauvegarde et restauration.

## 1. Prérequis

- Un serveur Linux (2 vCPU, 4 Go de RAM et 40 Go de disque suffisent pour démarrer), avec Docker et le plugin Docker Compose.
- Un nom de domaine pointant vers le serveur (ex. `boutique.amklabo.mr`).
- Un pare-feu n'ouvrant **que** les ports 22 (SSH), 80 et 443. La base de données n'est jamais exposée.
- Un emplacement de sauvegarde **hors du serveur** (autre machine, stockage externe).

## 2. Installation (Docker Compose)

```bash
git clone https://github.com/africashiplog/amklabo.git && cd amklabo
cat > .env <<'EOF'
OWNER_DB_PASSWORD=<mot de passe long et aléatoire>
APP_DB_PASSWORD=<autre mot de passe long et aléatoire>
APP_URL=https://boutique.amklabo.mr
EOF
chmod 600 .env

docker compose up -d db                                   # base PostgreSQL 16
docker compose run --rm tools                             # migrations + rôle applicatif aux droits restreints
docker compose run --rm tools npm run db:seed             # catégories, zone Nouakchott (inactive), pages
docker compose run --rm -e ADMIN_PASSWORD='<mot de passe>' tools \
  npm run admin:create -- --email vous@amklabo.mr --name "Votre nom"
docker compose up -d app                                  # application sur 127.0.0.1:3000
curl -s http://127.0.0.1:3000/api/sante                   # {"statut":"ok"}
```

Générer les mots de passe avec `openssl rand -hex 24`. Ne jamais les commiter.

L'application se connecte avec le rôle `amklabo_app` : celui-ci ne peut ni modifier la structure de la base, ni modifier ou effacer le journal d'audit, les mouvements de stock, l'historique des commandes, des paiements et des livraisons.

## 3. HTTPS (obligatoire)

Placez un proxy inverse devant l'application. Exemple avec **Caddy**, qui obtient et renouvelle automatiquement le certificat :

```
# /etc/caddy/Caddyfile
boutique.amklabo.mr {
    encode gzip
    request_body {
        max_size 8MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

- Le proxy doit transmettre l'en-tête `Host` d'origine (comportement par défaut de Caddy et nginx), sinon les formulaires (Server Actions) sont refusés par la protection contre la falsification de requêtes.
- Il doit aussi transmettre `X-Forwarded-For` : la limitation des tentatives de connexion et des inscriptions se fait par adresse IP.
- En production, le cookie de session est `Secure` (HTTPS uniquement) et l'en-tête HSTS est envoyé.

## 4. Sauvegardes

À planifier **chaque jour** (cron), puis à copier hors du serveur :

```bash
# Base de données (format compressé)
docker compose exec -T db pg_dump -U amklabo_owner -Fc amklabo > backups/amklabo-db-$(date +%F).dump
# Fichiers téléversés (images produits, logo, justificatifs de paiement)
docker run --rm -v amklabo_uploads:/data:ro -v "$PWD/backups":/b node:22-alpine \
  tar czf /b/amklabo-fichiers-$(date +%F).tgz -C /data .
```

Hors Docker, `npm run backup` fait les deux opérations, contrôle l'archive et supprime les sauvegardes de plus de `BACKUP_KEEP_DAYS` jours (30 par défaut).

**Tester la restauration au moins une fois par trimestre**, dans une base vide :

```bash
docker compose exec -T db psql -U amklabo_owner -d postgres -c "CREATE DATABASE restore_test"
docker compose exec -T db pg_restore -U amklabo_owner --no-owner -d restore_test < backups/amklabo-db-AAAA-MM-JJ.dump
```

Hors Docker : `scripts/restore.sh <fichier.dump> <url-base-vide> [archive-fichiers.tgz]`. Le script refuse une base non vide. Lancez ensuite `npm run db:migrate` sur la base restaurée pour recréer les droits du rôle applicatif.

Les justificatifs de paiement contiennent des données personnelles : les sauvegardes doivent être stockées chiffrées et à accès restreint.

## 5. Maintenance

```bash
# Chaque nuit : purge des sessions expirées, anciennes tentatives de connexion et notifications lues
docker compose run --rm tools npm run maintenance
```

Exemple de crontab (utilisateur de déploiement) :
```
15 2 * * * cd /srv/amklabo && docker compose exec -T db pg_dump -U amklabo_owner -Fc amklabo > backups/amklabo-db-$(date +\%F).dump
30 2 * * * cd /srv/amklabo && docker compose run --rm tools npm run maintenance
```

## 6. Mises à jour

```bash
git pull
docker compose build
docker compose run --rm tools          # applique les nouvelles migrations (chacune dans une transaction)
docker compose up -d app
curl -s http://127.0.0.1:3000/api/sante
```

Faites une sauvegarde **avant** chaque mise à jour. En cas de problème, revenez au commit précédent (`git checkout <commit>`), reconstruisez et redémarrez. Les migrations ne sont jamais annulées automatiquement : une migration fautive se corrige par une nouvelle migration, après restauration si nécessaire.

## 7. Supervision

- Santé : `GET /api/sante` (200 si l'application et la base répondent, 503 sinon). Le conteneur l'utilise comme contrôle de santé intégré.
- Journaux : `docker compose logs -f app`. Les erreurs inattendues sont consignées sans données personnelles inutiles, et l'utilisateur ne voit qu'un message générique.
- Actions sensibles : Administration → Journal d'audit (lecture seule).

## 8. Installation sans Docker

Node.js 22 et PostgreSQL 16 (extensions `citext` et `pgcrypto`) : voir le README, section Installation. Pour la production : `npm run build`, puis copier `public/` dans `.next/standalone/public` et `.next/static` dans `.next/standalone/.next/static`, puis lancer `node .next/standalone/server.js` avec `NODE_ENV=production`, `PORT`, `DATABASE_URL` et `UPLOAD_DIR` (un dossier persistant et sauvegardé).

**Supabase ou un PostgreSQL géré** peut servir d'hébergeur de base : appliquer les migrations avec l'URL du propriétaire, et l'application avec le rôle `amklabo_app`. Cette variante n'a pas été testée dans le cadre de ce projet.

## 9. Sécurité d'exploitation

- **Un compte nominatif par personne.** Aucun compte partagé ; attribuez à chacun le rôle minimal nécessaire.
- **Départ d'un employé :** suspendez son compte (Utilisateurs et rôles), ce qui ferme immédiatement ses sessions.
- **Mot de passe oublié :** il n'y a pas d'envoi d'e-mail. Un administrateur génère un mot de passe temporaire après avoir **vérifié l'identité** de la personne.
- **Double authentification :** elle n'est pas disponible. Protégez particulièrement les comptes administrateur et comptable (mots de passe longs et uniques).
- **Mises à jour de sécurité :** surveillez `npm audit --omit=dev` et les mises à jour de Next.js. Appliquez les correctifs de sécurité rapidement (voir section 6).
- **Fichier `.env` :** permissions `600`, jamais copié ailleurs que dans le gestionnaire de secrets de l'équipe.

## 10. Liste de mise en service

1. Paramètres du magasin : coordonnées, raison sociale, NIF, registre du commerce, coordonnées bancaires, mentions de facture. Le régime fiscal (taux de taxe) et le modèle de facture doivent être **validés par votre comptable**.
2. Pages de contenu : conditions générales, confidentialité, livraison et retours, à propos. À rédiger et à **faire valider juridiquement**.
3. Zones de livraison : frais et seuil de gratuité de Nouakchott, puis activation.
4. Moyens de paiement : comptes marchands officiels et instructions, puis activation.
5. Comptes du personnel : gestionnaire de stock, gestionnaire des commandes, comptable, livreurs.
6. Catalogue : catégories, produits, prix, paliers, photos et caractéristiques **vérifiées**.
7. Stock initial : entrées par lots, avec les dates de péremption réelles.
8. Commande test complète avec un vrai client et un vrai paiement de faible montant, de la commande jusqu'à la facture.
9. Première sauvegarde et test de restauration.
