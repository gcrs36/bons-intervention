# Mise à jour multi-formulaires Kizeo — version 3

Cette version ajoute les formulaires actifs relevés dans Kizeo à l’application GCRS Interventions.

## Documents disponibles

- Bon d’intervention : GCRS, ABEG, ARBOREAL, Dimensions et ESI.
- Visite trimestrielle massicot : GCRS, ABEG, ARBOREAL et ESI.
- Procès-verbal de mise en service : GCRS.
- Fiche machine atelier : GCRS.

Le formulaire Dimensions historique reste disponible à l’adresse `/form-dimensions.html`. Le nouvel écran commun est `/nouveau.html`.

## Déploiement sur GitHub et Render

1. Copier tous les fichiers du paquet à la racine du dépôt `bons-intervention`, en conservant les dossiers `lib`, `public`, `scripts` et `test`.
2. Remplacer les fichiers existants lorsque GitHub le demande.
3. Vérifier que `server.js`, `package.json`, `lib/bon-types.js`, `lib/pdf-generic.js`, `public/nouveau.html` et `public/nouveau.js` sont visibles dans le dépôt.
4. Valider avec **Commit changes**.
5. Laisser Render lancer le déploiement automatique.

Aucune nouvelle variable Render n’est nécessaire. Les variables Dolibarr existantes restent utilisées.

## Fonctionnement Dolibarr

Pour les documents synchronisés, l’application conserve le flux déjà validé :

1. création ou recherche du tiers ;
2. fiche d’intervention ;
3. commande brouillon seulement lorsqu’une pièce est saisie ;
4. facture en brouillon ;
5. PDF joint à la fiche ou classé dans la GED générale selon la version de Dolibarr.

La fiche machine atelier reste locale par défaut. La synchronisation peut être cochée manuellement si elle doit créer une intervention Dolibarr.

## Données et sécurité

- Les anciens bons déjà présents dans SQLite restent compatibles.
- Les nouvelles colonnes de base de données sont créées automatiquement au démarrage.
- Les photos publiques sont incluses dans le PDF client.
- Les photos et notes confidentielles ne sont pas imprimées dans le PDF client.
- Sur Render Free, les fichiers locaux restent éphémères. La copie PDF vers Dolibarr/sa GED est donc recommandée.

## Vérifications réalisées

- 17 tests automatisés réussis.
- Création locale via l’API et téléchargement du PDF réussis.
- Contrôle visuel de toutes les pages des quatre familles de PDF.
- Checklist massicot complète : 42 lignes, de A1 à D38.
