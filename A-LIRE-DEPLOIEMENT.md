# Mise à jour PWA v4 — dépôt GitHub

Ne supprimez pas les autres dossiers du dépôt (`lib`, `models`, `scripts`, etc.).

## 1. Fichiers à la racine du dépôt

Ouvrez la page principale du dépôt GitHub `bons-intervention`, puis **Add file → Upload files**.

Téléversez les quatre fichiers placés à la racine de ce paquet :

- `server.js`
- `package.json`
- `README.md`
- `GUIDE-PWA-HORS-LIGNE.md`

## 2. Dossier public

Dans GitHub, ouvrez le dossier `public`, puis **Add file → Upload files**.

Sélectionnez tous les fichiers qui se trouvent à l’intérieur du dossier `public` de ce paquet. Les fichiers existants portant le même nom doivent être remplacés.

## 3. Test facultatif mais recommandé

Dans GitHub, ouvrez le dossier `test` et téléversez `pwa.test.js`.

## 4. Valider

En bas de la page d’envoi GitHub :

1. laissez **Commit directly to the main branch** sélectionné ;
2. saisissez `Version 4 - application installable et hors ligne` ;
3. cliquez sur le bouton vert **Commit changes**.

Render lancera ensuite le déploiement automatiquement.

## 5. Premier démarrage

Une fois Render au vert, ouvrez l’application avec Internet et actualisez la page. Cliquez ensuite sur **Installer l’application**.

Le premier chargement doit se faire avec Internet afin d’enregistrer les écrans et les modèles sur l’appareil.
