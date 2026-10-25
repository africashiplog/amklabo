# Recette — critères d'acceptation (section 20 du cahier des charges)

Légende des preuves :
- **Auto** : test d'intégration (`npm test`, 123 tests sur une vraie base PostgreSQL).
- **Navigateur** : parcours Chromium (`npm run test:e2e`, 52 étapes), exécuté sur l'image Docker de production.
- **Manuel** : à vérifier par AMKLABO.
- **Fournisseur** : nécessite un vrai compte ou service externe.

| # | Critère | Statut | Preuve |
|---|---|---|---|
| 1 | Le logo AMKLABO apparaît correctement sur le site et les factures | ✅ | Navigateur (logo chargé, proportions conservées) ; Auto (PDF contenant l'image). **Manuel** : contrôle visuel d'une facture imprimée. |
| 2 | Les visiteurs peuvent consulter le catalogue | ✅ | Navigateur (accueil, catalogue, recherche, fiche produit sans connexion) |
| 3 | Les clients particuliers voient les prix publics | ✅ | Auto `pricing` ; Navigateur |
| 4 | Les comptes professionnels non approuvés n'accèdent pas aux tarifs de gros | ✅ | Auto `pricing` (en attente, suspendu) ; Navigateur (avant et après approbation) |
| 5 | Les tarifs de gros changent correctement selon les quantités | ✅ | Auto `pricing` (paliers 1, 10, 49, 50) ; Navigateur (9 puis 10 unités) |
| 6 | Les prix et les remises sont calculés côté serveur | ✅ | Auto `pricing`, `orders` (total recalculé, refus si le montant affiché a changé) |
| 7 | Un client ne peut pas consulter les commandes d'un autre client | ✅ | Auto `orders`, `invoices`, `payments`, `security` ; Navigateur (PDF et justificatif refusés aux autres) |
| 8 | Le stock ne peut pas être vendu deux fois lors de commandes concurrentes | ✅ | Auto `orders` (4 commandes simultanées sur un stock de 5) et `stock` (6 sorties simultanées) ; contraintes en base |
| 9 | Les mouvements de stock sont traçables | ✅ | Auto `stock` (historique immuable, solde après mouvement) ; Navigateur |
| 10 | Les commandes sont enregistrées dans la base de données | ✅ | Auto `orders` ; Navigateur |
| 11 | Les factures peuvent être générées, téléchargées et imprimées | ✅ | Auto `invoices` ; Navigateur (téléchargement PDF). **Manuel** : impression papier. |
| 12 | Les factures émises ne peuvent pas être effacées silencieusement | ✅ | Auto `invoices` (refus par la base, y compris pour le propriétaire du schéma) |
| 13 | Les modifications importantes sont enregistrées dans le journal d'audit | ✅ | Auto (prix, stock, rôles, paiements, factures, comptes) ; Navigateur (journal) |
| 14 | Les paiements manuels restent en attente jusqu'à leur vérification | ✅ | Auto `payments` ; Navigateur (Bankily, espèces) |
| 15 | Les paiements ne peuvent pas être confirmés deux fois par erreur | ✅ | Auto `payments` (3 confirmations simultanées, référence unique, paiement figé) |
| 16 | Les statuts de commande, de paiement et de livraison restent distincts | ✅ | Auto `payments` (livraisons) ; Navigateur |
| 17 | Les rôles et permissions sont vérifiés côté serveur | ✅ | Auto (refus par rôle dans chaque module) ; Navigateur (livreur, client) |
| 18 | Les erreurs sont gérées sans divulguer d'informations sensibles | ✅ | Revue de code (`docs/SECURITE.md`) ; Navigateur (aucune erreur JavaScript, aucune violation CSP) |
| 19 | Les pages fonctionnent sur téléphone, tablette et ordinateur | ✅ | Navigateur (375, 768 et 1280 px, sans défilement horizontal ; écran livreur à 390 px). **Manuel** : essai sur de vrais téléphones. |
| 20 | Les instructions de configuration et de déploiement sont documentées | ✅ | `README.md`, `DEPLOIEMENT.md` ; déploiement Docker Compose exécuté sur une base vide, avec sauvegarde et restauration testées |

## Ce qui reste à vérifier avec de vrais comptes ou services

| Élément | Pourquoi | Action |
|---|---|---|
| Bankily, Masrivi, Sedad, Bimbank, Click | Aucune API officielle ni compte marchand fourni ; la procédure manuelle est testée avec des comptes fictifs | Saisir les comptes officiels, puis faire un paiement réel de faible montant pour chaque moyen activé |
| Paiement à la livraison | Procédure testée ; la remise réelle des espèces dépend de l'organisation interne | Définir qui confirme la remise en caisse (comptable) et quand |
| Conformité des factures | Les mentions légales et le régime fiscal ne sont pas validés | Validation par un comptable ou expert-comptable mauritanien |
| Textes juridiques | Pages laissées « à rédiger » volontairement | Rédaction et validation juridique |
| E-mail / SMS | Non configurés : notifications dans l'espace client uniquement | Choisir un fournisseur si nécessaire (coût et compte requis) |
| Hébergement, HTTPS et sauvegardes externes | Dépendent du serveur choisi | Suivre `DEPLOIEMENT.md`, puis tester une restauration |
| Charge réelle | Aucun test de charge effectué | Tester avec le volume attendu avant une campagne commerciale |
| Arabe | Architecture prête (direction RTL, propriétés logiques), traduction non faite ; PDF limités aux caractères latins | Traduction et police arabe si nécessaire |
