const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');
const puppeteer = require('puppeteer'); // Moteur PDF
const app = express();

const PORT = process.env.PORT || 10000;

// Création du dossier pour stocker les PDF
const pdfDir = path.join(__dirname, 'public', 'pdfs');
if (!fs.existsSync(pdfDir)){
    fs.mkdirSync(pdfDir, { recursive: true });
}

// Configuration de la base de données SQLite
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Erreur de connexion à SQLite', err.message);
    else {
        console.log('Connecté à la base de données SQLite.');
        db.run(`CREATE TABLE IF NOT EXISTS bons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date_et_heure1 TEXT, ref_cde_client TEXT, bon_de TEXT, client TEXT,
            tel_ TEXT, adresse TEXT, mail TEXT, type_materiel_ TEXT,
            n_de_matricule_ TEXT, travail_effectue TEXT, temps_passe TEXT,
            non_du_technicien TEXT, nom_du_signataire_ TEXT, pdf_url TEXT
        )`);
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Affiche la page d'accueil avec les boutons (formulaire)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'form-dimensions.html'));
});

// Création du bon d'intervention
app.post('/api/create-intervention-dimensions', async (req, res) => {
    const {
        date_et_heure1, ref_cde_client, bon_de, client, tel_, adresse,
        mail, type_materiel_, n_de_matricule_, travail_effectue,
        temps_passe, non_du_technicien, nom_du_signataire_, signature
    } = req.body;

    const pdfFilename = `bon_${Date.now()}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    const pdf_url = `/pdfs/${pdfFilename}`;

    try {
        // 1. Lire le modèle HTML
        let htmlTemplate = fs.readFileSync(path.join(__dirname, 'modele.html'), 'utf-8');

        // ---------------------------------------------------------
        // 1 BIS : NOUVEAUTÉ - INJECTION DU LOGO EN TEXTE (BASE64)
        // ---------------------------------------------------------
        const logoPath = path.join(__dirname, 'public', 'logo-enquete.png');
        if (fs.existsSync(logoPath)) {
            const logoBase64 = fs.readFileSync(logoPath).toString('base64');
            const logoSrc = `data:image/png;base64,${logoBase64}`;
            htmlTemplate = htmlTemplate.replace('{{logo_img}}', logoSrc);
        } else {
            console.log("Attention : Le logo-enquete.png n'a pas été trouvé dans le dossier public.");
            htmlTemplate = htmlTemplate.replace('{{logo_img}}', ''); // On vide si l'image manque
        }
        // ---------------------------------------------------------

        // 2. Remplacer les balises par les données du formulaire
        htmlTemplate = htmlTemplate.replace('{{bon_de}}', bon_de || '');
        htmlTemplate = htmlTemplate.replace('{{date_et_heure1}}', date_et_heure1 || '');
        htmlTemplate = htmlTemplate.replace('{{client}}', client || '');
        htmlTemplate = htmlTemplate.replace('{{ref_cde_client}}', ref_cde_client || '');
        htmlTemplate = htmlTemplate.replace('{{adresse}}', adresse || '');
        htmlTemplate = htmlTemplate.replace('{{tel_}}', tel_ || '');
        htmlTemplate = htmlTemplate.replace('{{mail}}', mail || '');
        htmlTemplate = htmlTemplate.replace('{{type_materiel_}}', type_materiel_ || '');
        htmlTemplate = htmlTemplate.replace('{{n_de_matricule_}}', n_de_matricule_ || '');
        htmlTemplate = htmlTemplate.replace('{{travail_effectue}}', (travail_effectue || '').replace(/\n/g, '<br>'));
        htmlTemplate = htmlTemplate.replace('{{temps_passe}}', temps_passe || '');
        htmlTemplate = htmlTemplate.replace('{{non_du_technicien}}', non_du_technicien || '');
        htmlTemplate = htmlTemplate.replace('{{nom_du_signataire_}}', nom_du_signataire_ || '');

        // Gérer la signature
        if (signature && signature.startsWith('data:image/png;base64,')) {
            htmlTemplate = htmlTemplate.replace('{{signature_img}}', `<img src="${signature}" style="max-height: 80px; max-width: 200px;" />`);
        } else {
            htmlTemplate = htmlTemplate.replace('{{signature_img}}', '');
        }

        // 3. Générer le PDF avec Puppeteer
        const browser = await puppeteer.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Empêche le crash dû à la mémoire partagée sur Render
                '--disable-gpu',           // Désactive la carte graphique (inutile sur serveur)
                '--no-zygote',
                '--single-process'         // Force Chrome à utiliser un seul processus ultra-léger
            ]
        });
        const page = await browser.newPage();
        await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });
        await page.pdf({ 
            path: pdfPath, 
            format: 'A4', 
            printBackground: true, // IMPORTANT : Ajouté pour imprimer les couleurs (tableau gris)
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' } 
        });
        await browser.close();

        // 4. Enregistrer dans la base de données
        const query = `INSERT INTO bons (
            date_et_heure1, ref_cde_client, bon_de, client, tel_, adresse,
            mail, type_materiel_, n_de_matricule_, travail_effectue,
            temps_passe, non_du_technicien, nom_du_signataire_, pdf_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const params = [
            date_et_heure1, ref_cde_client, bon_de, client, tel_, adresse,
            mail, type_materiel_, n_de_matricule_, travail_effectue,
            temps_passe, non_du_technicien, nom_du_signataire_, pdf_url
        ];

        db.run(query, params, function(err) {
            if (err) return res.status(500).send("Erreur BDD : " + err.message);
            res.redirect('/historique.html'); // Redirection vers ton historique
        });

    } catch (error) {
        console.error("Erreur lors de la création du PDF :", error);
        res.status(500).send("Erreur lors de la génération du PDF.");
    }
});

// Route de l'historique
app.get('/api/bons', (req, res) => {
    db.all("SELECT * FROM bons ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ bons: rows });
    });
});

app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));