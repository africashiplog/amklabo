# AMKLABO — Medical & Laboratory

Plateforme e-commerce (détail et gros) de matériel médical et de laboratoire pour la Mauritanie.
**État : Phases 1 (fondation) et 2 (clients, prix, stock) terminées.**

## Architecture

| Élément | Choix | Raison |
|---|---|---|
| Interface + serveur | Next.js 15 (App Router), React 19, TypeScript | Rendu serveur, actions serveur : toute opération sensible s'exécute côté serveur |
| Base de données | PostgreSQL 16, migrations SQL versionnées (`db/migrations`) | Contraintes, transactions, verrous (indispensables pour stock et factures) |
| Authentification | Maison : scrypt + sessions en base (jeton haché, cookie `httpOnly`) | Aucun service externe requis ; portable |
| Autorisation | Matrice rôle → permissions (`src/server/permissions.ts`), vérifiée dans **chaque service** | Cacher un bouton ne protège rien |
| Défense en base | Rôle `amklabo_app` sans droits DDL ; journal d'audit non modifiable (droits + déclencheur) | Même une faille applicative ne peut effacer l'audit |
| Fichiers | Disque local (`UPLOAD_DIR`), type validé par signature binaire | À remplacer par un stockage objet si plusieurs serveurs |
| Styles | Tailwind CSS, palette du logo, propriétés logiques (prêt pour l'arabe RTL) | |

Supabase n'est pas requis. Si vous l'utilisez, il peut servir d'**hébergeur PostgreSQL** (mêmes migrations) ; l'authentification reste celle de l'application.

Montants : entiers en unités mineures (1 MRU = 100), jamais de virgule flottante ; une saisie de plus de 2 décimales est refusée.

### Arborescence
```
db/migrations/      schéma SQL          db/grants.sql   droits du rôle applicatif
scripts/            migrate, seed, create-admin
src/server/         db, sessions, permissions, audit, stockage, services/* (logique métier)
src/app/(site)/     site public et espace client     src/app/admin/   administration
tests/              tests d'intégration (Vitest, base réelle)     e2e/   parcours navigateur
```

## Règles métier (Phase 2)

### Tarification (`src/server/services/pricing.ts`)
Tous les prix sont calculés côté serveur ; un prix venant du navigateur n'est jamais utilisé.
1. **Prix négocié** d'un client professionnel *approuvé* (valide à la date et pour la quantité) : prioritaire, aucune autre règle ne s'applique.
2. Sinon, le client paie le **meilleur prix unitaire** parmi : prix public, paliers auxquels il a droit (« tous » ou « professionnels » si approuvé), promotions actives qui le concernent (appliquées au prix public). **Aucun cumul.**
- Remise en % arrondie à l'unité mineure la plus proche (demi au supérieur), calcul en entiers.
- Un compte pro en attente, refusé ou suspendu, ou un client suspendu, n'a pas accès aux tarifs de gros.
- Seul l'administrateur (`pricing.manage`) fixe les prix. Un produit créé par le gestionnaire de stock reste en brouillon, sans prix.

### Stock (`src/server/services/stock.ts`)
- Stock par lots (numéro et péremption obligatoires si le produit est « suivi par lots »), en unités de vente.
- Toute variation crée un mouvement **immuable** (droits + déclencheur) avec le solde après opération.
- `CHECK (qty_on_hand >= 0)` en base : aucune survente possible, même en concurrence (testé avec 6 sorties simultanées).
- Sorties automatiques en **FEFO** (premier périmé, premier sorti) ; les lots périmés ne sont jamais proposés à la vente.
- Inventaire : alignement d'un lot sur la quantité comptée (ajustement tracé).
- Bons d'achat numérotés sans trou (`BA-AAAA-NNNN`) ; la réception (totale ou partielle) crée les lots.

### Clients
- Archivage et suspension réversibles, avec fermeture des sessions.
- Suppression définitive : administrateur uniquement, client archivé et **sans historique**.
- Sinon **anonymisation** : effacement des données personnelles, historique conservé.
- Notes internes en ajout seul, jamais visibles par le client.

### Matrice des rôles
| Permission | Admin | Stock | Commandes | Comptable | Livreur |
|---|:-:|:-:|:-:|:-:|:-:|
| Catalogue (hors prix) | ✓ | ✓ | | | |
| Prix, paliers, promotions, prix négociés | ✓ | | | | |
| Stock, lots, inventaire | ✓ | ✓ | | | |
| Fournisseurs, bons d'achat | ✓ | ✓ | | | |
| Coûts d'achat (lecture) | ✓ | ✓ | | ✓ | |
| Clients (lecture) | ✓ | | ✓ | ✓ | |
| Clients (modification, notes, statut) | ✓ | | ✓ | | |
| Approbation des comptes pro | ✓ | | | | |
| Suppression / anonymisation | ✓ | | | | |
| Paramètres, utilisateurs, audit | ✓ | | | | |

Le rôle Livreur n'a encore aucun écran (module livraison : Phase 4).

## Installation

Prérequis : Node.js 22, PostgreSQL 16 (extensions `citext`, `pgcrypto`).

```bash
npm ci
cp .env.example .env            # renseigner les mots de passe
# En superutilisateur PostgreSQL :
#   CREATE ROLE amklabo_owner LOGIN PASSWORD '…' CREATEROLE;
#   CREATE DATABASE amklabo OWNER amklabo_owner;
#   \c amklabo
#   CREATE EXTENSION citext; CREATE EXTENSION pgcrypto;
npm run db:migrate              # schéma + rôle amklabo_app + droits
npm run db:seed                 # paramètres, 11 catégories, zone Nouakchott (inactive), pages
npm run admin:create -- --email vous@domaine.mr --name "Votre nom"
npm run dev                     # http://localhost:3000
```

## Tests
```bash
npm test                        # 74 tests d'intégration sur la base amklabo_test (réinitialisée à chaque lancement)
npm run build && <démarrer le serveur sur la base de test, port 3100>
BASE_URL=http://localhost:3100 ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run test:e2e   # 28 étapes Chromium
```
La base `amklabo_test` doit exister (même propriétaire, mêmes extensions).

## Déploiement
- `npm run build` produit un serveur autonome (`.next/standalone`).
- En production : HTTPS obligatoire (cookie `secure`), `NODE_ENV=production`, `DATABASE_URL` avec le rôle `amklabo_app` uniquement.
- Le proxy doit transmettre `X-Forwarded-For` (limitation des tentatives de connexion par IP).
- `UPLOAD_DIR` sur un volume persistant et sauvegardé ; sauvegarde quotidienne de PostgreSQL (`pg_dump`).
- Aucune clé secrète n'est envoyée au navigateur.

## Ce que doit fournir AMKLABO
- Coordonnées, informations de facturation (raison sociale, NIF, RC) : *Administration → Paramètres*.
- Textes des CGV, confidentialité, livraison/retours, à propos (à faire valider juridiquement) : *Pages de contenu*.
- Frais de livraison de Nouakchott, puis activation de la zone.
- Le fichier source du logo en haute résolution / vectoriel si disponible (le logo actuel est celui fourni, recadré de ses marges blanches uniquement ; l'original est dans `public/brand/logo-original.webp`).
- Le catalogue réel : produits, prix, photos et caractéristiques vérifiées.

## Feuille de route
- ~~Phase 2~~ : comptes professionnels, tarification, stock par lots, fournisseurs et achats, gestion complète des clients.
- **Phase 3** : panier, commandes (réservation de stock transactionnelle via `allocateFefo`/`applyMovement`, prix figés depuis `quoteLines`), factures PDF, avoirs, historique client.
- **Phase 4** : paiements (procédure manuelle de vérification Bankily/Masrivi/Sedad/Bimbank/Click/espèces ; API officielles si disponibles), livraisons et livreurs.
- **Phase 5** : rapports, exports CSV, notifications (e-mail/SMS : fournisseur à choisir), traduction arabe.
