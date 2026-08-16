# Déployer la version 4.2 sur GitHub et Render

## Emplacement exact

Le dossier à envoyer est `bons-intervention-main`. Sa **racine** est l’endroit où se trouvent directement `server.js`, `package.json`, `render.yaml`, les dossiers `public`, `lib`, `test` et `templates-kizeo`.

## Méthode GitHub depuis le navigateur

1. Ouvrir le dépôt `gcrs36/bons-intervention` sur GitHub.
2. Cliquer sur **Add file**, puis **Upload files**.
3. Ouvrir sur l’ordinateur le dossier `bons-intervention-main` fourni dans cette livraison.
4. Sélectionner **tout son contenu**, puis le faire glisser dans la zone GitHub. Ne pas déposer le dossier parent lui-même.
5. Vérifier que GitHub affiche notamment `server.js`, `lib/bon-types.js`, `lib/kizeo-schema.json`, `public/nouveau.js`, les cinq logos et le dossier `templates-kizeo`.
6. Dans **Commit changes**, saisir `Version 4.2 - formulaires Kizeo fidèles`, puis valider.

Les dossiers sont créés automatiquement par GitHub lorsque leurs fichiers sont déposés. Il n’est pas nécessaire de créer séparément `lib`, `public` ou `templates-kizeo`.

## Render

1. Ouvrir le service `bons-intervention` dans Render.
2. Si le déploiement automatique est actif, attendre la fin du nouveau déploiement. Sinon, cliquer sur **Manual Deploy**, puis **Deploy latest commit**.
3. Le journal doit finir par `GCRS Interventions disponible sur le port ...`.
4. Ouvrir l’application, puis forcer une actualisation pour remplacer l’ancien cache : `Ctrl + F5` sous Windows.
5. Vérifier que l’écran **Nouveau document** affiche six sociétés et 24 formulaires au total.

Ne modifiez pas les variables `DOLIBARR_URL`, `DOLIBARR_API_KEY`, `DATA_DIR`, `DB_PATH`, `APP_USER` et `APP_PASSWORD` déjà présentes dans Render.
