# GCRS Interventions

Application web mobile installable de gestion des bons d’intervention, avec signature, mode hors ligne, PDF, export Excel et synchronisation serveur vers Dolibarr 23.

## Classement des formulaires

La version 4.2 reprend l’inventaire actif de Kizeo : l’utilisateur choisit d’abord la société, puis seulement l’un de ses formulaires d’origine.

- **GCRS** : 15 formulaires terrain, atelier, commerce et frais ;
- **Dimensions** : 1 formulaire ;
- **ESI** : 3 formulaires ;
- **ABEG** : 2 formulaires ;
- **ARBOREAL** : 2 formulaires ;
- **Clementz** : 1 formulaire.

Les 24 formulaires actifs représentent 1 343 champs repris dans leur ordre Kizeo. Les séparateurs deviennent des sections, les tableaux commencent avec une ligne et peuvent grandir, et les champs longs adaptent leur hauteur dans le PDF. Les logos Kizeo d’origine de GCRS, Dimensions, ESI, ABEG et ARBOREAL sont utilisés dans l’application et les PDF ; le formulaire Clementz ne contenait pas d’image fixe Kizeo. Les 28 modèles Word personnalisés récupérés sont conservés dans `templates-kizeo/` comme sources de mise en page. Le modèle Dimensions conserve en plus son générateur PDF dédié.

## Application installable et mode hors ligne

La version 4 est une Progressive Web App (PWA) : elle s’installe depuis le navigateur sur Android, Windows, macOS et iOS, puis s’ouvre dans sa propre fenêtre.

- les écrans principaux et les modèles sont conservés sur l’appareil ;
- un bon finalisé sans Internet est placé dans une file d’attente locale avec ses signatures et ses photos ;
- l’historique distingue clairement les bons hors ligne ;
- au retour de la connexion, les bons sont envoyés au serveur, le PDF est généré et le flux Dolibarr est lancé ;
- un identifiant unique empêche de créer un doublon si la réponse réseau est interrompue après l’enregistrement.

Le premier chargement et l’installation doivent être réalisés avec Internet. Tant qu’un bon est indiqué « Hors ligne », ne pas effacer les données du navigateur ni désinstaller l’application : ce bon n’existe encore que sur cet appareil.

La procédure utilisateur détaillée se trouve dans `GUIDE-PWA-HORS-LIGNE.md`.

## Flux Dolibarr retenu

Lors de la synchronisation d’un bon signé :

1. le client Dolibarr est retrouvé ou créé ;
2. une fiche d’intervention et sa ligne de temps sont créées ;
3. le PDF signé est joint à la fiche d’intervention ;
4. si des pièces sont présentes, une commande brouillon est créée avec ses lignes ;
5. une facture brouillon est créée depuis la commande, ou directement s’il n’y a aucune pièce.

Ni la commande ni la facture ne sont validées automatiquement.

## Installation locale

Prérequis : Node.js 22.5 ou plus récent (l’application utilise SQLite intégré à Node.js).

```bash
npm install
npm test
npm start
```

L’application écoute par défaut sur `http://localhost:10000`.

## Configuration

Copier les variables utiles de `.env.example` dans l’environnement Render. Les secrets ne doivent pas être ajoutés au dépôt GitHub.

| Variable | Usage |
| --- | --- |
| `DOLIBARR_URL` | URL racine de Dolibarr, ici `https://dolibarr.gcrs.fr` |
| `DOLIBARR_API_KEY` | Clé de l’utilisateur API Dolibarr |
| `DOLIBARR_ENTITY` | Entité Dolibarr, généralement `1` |
| `DOLIBARR_VAT_RATE` | TVA appliquée aux nouvelles lignes, `20` par défaut |
| `APP_USER` / `APP_PASSWORD` | Protection de l’application par authentification HTTP |
| `DATA_DIR` / `DB_PATH` | Emplacement persistant de SQLite et des PDF |

## Activation dans Dolibarr 23.0.3

1. Aller dans **Accueil → Configuration → Modules/Applications**.
2. Activer les modules **API REST**, **Tiers**, **Interventions**, **Commandes clients**, **Factures clients** et **Produits/Services**.
3. Créer un utilisateur technique dédié, par exemple `api_interventions`.
4. Lui accorder uniquement les droits de lecture/création nécessaires sur les tiers, interventions, commandes, factures et documents.
5. Générer sa clé API dans sa fiche utilisateur.
6. Ajouter cette clé dans `DOLIBARR_API_KEY` sur Render, jamais dans le code.
7. Vérifier l’explorateur : `https://dolibarr.gcrs.fr/api/index.php/explorer/`.

## Déploiement Render

Le fichier `render.yaml` décrit le service, le disque persistant et les variables attendues. Un disque est important : sans lui, la base SQLite et les PDF peuvent disparaître lors d’un redéploiement.

Avant la mise en production :

- définir `APP_USER` et un mot de passe robuste ;
- définir `DOLIBARR_API_KEY` dans les secrets Render ;
- attacher un disque sur `/var/data` ;
- vérifier `/api/health`, puis créer un bon de test avec une pièce ;
- contrôler dans Dolibarr la fiche d’intervention, la commande et la facture brouillon.

## Sécurité

- la clé Dolibarr est utilisée uniquement par le serveur Node ;
- les valeurs insérées dans le PDF sont échappées ;
- les fichiers PDF sont servis par une route applicative ;
- une authentification configurable protège l’interface ;
- aucune commande ou facture Dolibarr n’est validée automatiquement.
