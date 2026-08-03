const express = require('express');
const path = require('path');
const app = express();

// Définir le port (celui de Render ou le port 3000 par défaut en local)
const PORT = process.env.PORT || 10000;

// 1. Rendre le dossier "public" accessible publiquement
app.use(express.static(path.join(__dirname, 'public')));

// Middleware pour lire les données JSON si besoin
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Rediriger automatiquement la page d'accueil vers votre formulaire
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'form-dimensions.html'));
});

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});