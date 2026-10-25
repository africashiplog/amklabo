# Revue de sécurité — AMKLABO (Phase 5)

Revue réalisée sur le code de ce dépôt (Phases 1 à 5). Elle couvre l'application et sa base de données ; l'hébergement (serveur, proxy, sauvegardes) relève de `DEPLOIEMENT.md`. **Ce n'est pas un test d'intrusion indépendant** : un audit externe reste recommandé avant d'ouvrir la boutique au public à grande échelle.

## Contrôles en place (et comment ils sont vérifiés)

| Domaine | Mesure | Vérification |
|---|---|---|
| Mots de passe | scrypt (N=2¹⁵) salé ; 10 caractères minimum ; jamais journalisés | tests `auth` |
| Connexion | message d'erreur identique (e-mail inconnu ou mot de passe faux), hachage factice pour un temps de réponse constant ; blocage après 5 échecs par e-mail ou 20 par IP en 15 min | tests `auth` |
| Inscription | 10 comptes maximum par IP et par heure | test `reports` (sécurité) |
| Sessions | jeton aléatoire de 256 bits, seul son hachage SHA-256 est stocké ; cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production ; expiration 14 jours ; fermeture de toutes les sessions au changement ou à la réinitialisation du mot de passe et à la suspension | tests `auth`, `security`, `customers` |
| Autorisations | matrice rôle → permissions vérifiée **dans chaque service serveur** (pas seulement dans l'interface) | tests par rôle dans chaque fichier de test ; parcours navigateur (livreur, client) |
| Isolation des clients | toutes les requêtes client sont filtrées par l'utilisateur connecté (adresses, commandes, factures, paiements, justificatifs) | tests `security`, `orders`, `invoices`, `payments` ; navigateur (PDF, justificatif) |
| Défense en base | rôle applicatif sans droit sur le schéma ; journal d'audit, mouvements de stock, historiques de commande, de paiement et de livraison, notes internes : ajout seul (droits + déclencheurs, y compris contre le propriétaire) | tests `security`, `stock`, `orders`, `payments` |
| Intégrité métier | stock jamais négatif ni sur-réservé (contraintes `CHECK`) ; facture émise et paiement traité figés par déclencheur ; numérotation sans trou ; idempotence des commandes ; unicité des références de transaction | tests de concurrence `stock`, `orders`, `payments` |
| Injection SQL | requêtes paramétrées ; tri et regroupements limités à des listes fermées | test d'injection `catalog` ; revue de code |
| XSS | rendu React échappé ; aucun HTML brut (`dangerouslySetInnerHTML` absent) ; textes saisis affichés en texte simple ; **CSP avec nonce par requête** et `strict-dynamic` | revue de code ; navigateur (aucune violation CSP) |
| CSRF | Server Actions de Next.js (vérification de l'origine) ; cookie `SameSite=Lax` | — |
| Fichiers téléversés | type vérifié par signature binaire (PNG, JPEG, WebP ; SVG refusé) ; 5 Mo maximum ; noms aléatoires ; chemins sous contrôle (aucune traversée) ; justificatifs de paiement **hors du dossier public**, servis après contrôle des droits | tests `unit` ; navigateur |
| Exports CSV | droits vérifiés ; export journalisé ; neutralisation de l'injection de formules (`=`, `+`, `-`, `@`) | tests `reports` |
| Redirections | seules les redirections internes sont acceptées après connexion | revue de code |
| Erreurs | aucune trace technique affichée à l'utilisateur ; journalisation serveur sans données personnelles inutiles | revue de code |
| En-têtes | CSP, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS en production | navigateur |
| Adresse IP | la dernière valeur de `X-Forwarded-For` (celle ajoutée par le proxy) est utilisée, ce qui empêche un client de la falsifier | revue de code |
| Paiements | aucun code PIN ni mot de passe demandé ou stocké ; aucune confirmation automatique | tests `payments` |
| Dépendances | `npm audit --omit=dev` : **0 vulnérabilité** après mise à jour de Next.js (15.5.4 → 15.5.28, faille critique corrigée), zod 4, sharp 0.35.5 et postcss 8.5.29 ; optimiseur d'images de Next désactivé (non utilisé) | `npm audit` |

## Corrections apportées pendant la revue

1. **Next.js 15.5.4 → 15.5.28.** La version précédente était affectée par une faille critique (exécution de code à distance dans le protocole React Server Components) et par une XSS liée aux nonces CSP, entre autres.
2. **zod 3 → 4** (épuisement mémoire sur des collections surdimensionnées), **sharp 0.35.5** et **postcss 8.5.29** : versions corrigées imposées.
3. **Adresse IP du client :** elle était lue dans la première valeur de `X-Forwarded-For`, falsifiable derrière un proxy nginx ; c'est désormais la dernière.
4. **Ajouts :** CSP avec nonce, HSTS, limitation des inscriptions, réinitialisation administrateur des mots de passe, purge des sessions expirées.

## Risques résiduels et recommandations

| Risque | Niveau | Recommandation |
|---|---|---|
| Pas de double authentification | Moyen | Mots de passe longs et uniques pour les administrateurs et comptables. À ajouter (application TOTP) si les comptes du personnel se multiplient. |
| Pas d'e-mail : la réinitialisation du mot de passe dépend d'un administrateur | Moyen | Vérifier l'identité avant de transmettre un mot de passe temporaire. Ajouter un service d'e-mail transactionnel avec lien de réinitialisation à durée limitée. |
| L'inscription révèle si un e-mail est déjà utilisé | Faible | Compromis courant pour l'ergonomie ; la limitation par IP freine l'énumération. |
| `style-src 'unsafe-inline'` dans la CSP | Faible | Nécessaire aux attributs `style` ; les scripts restent strictement contrôlés par nonce. |
| Limitation par IP stockée en base (pas de pare-feu applicatif) | Faible | Ajouter une limitation de débit au niveau du proxy (Caddy, nginx) ou un service anti-DDoS si la boutique devient une cible. |
| Plusieurs proxys en cascade (ex. CDN puis Caddy) | À configurer | Configurer le proxy pour qu'il transmette la véritable IP du client (ex. `trusted_proxies` de Caddy pour le CDN). |
| Le journal d'audit conserve l'e-mail des auteurs, même après anonymisation | Juridique | Durée de conservation à valider ; purge éventuelle par une procédure documentée hors application. |
| Outils de développement (Vitest 3) signalés par `npm audit` | Faible | Non livrés en production. La mise à jour vers Vitest 4 se heurte actuellement à un bug de npm (`edgesOut`) : à refaire avec une version corrigée de npm. |
| Justificatifs de paiement (données personnelles) dans les sauvegardes | Moyen | Chiffrer les sauvegardes et en restreindre l'accès. |
| Polices PDF limitées aux caractères latins | Fonctionnel | Intégrer une police arabe avant d'émettre des factures en arabe. |
