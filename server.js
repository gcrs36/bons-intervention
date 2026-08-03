const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const app = express();

const PORT = process.env.PORT || 10000;

const pdfDir = path.join(__dirname, 'public', 'pdfs');
if (!fs.existsSync(pdfDir)){
    fs.mkdirSync(pdfDir, { recursive: true });
}

const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erreur de connexion à SQLite', err.message);
    } else {
        console.log('Connecté à la base de données SQLite.');
        db.run(`CREATE TABLE IF NOT EXISTS bons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date_et_heure1 TEXT,
            ref_cde_client TEXT,
            bon_de TEXT,
            client TEXT,
            tel_ TEXT,
            adresse TEXT,
            mail TEXT,
            type_materiel_ TEXT,
            n_de_matricule_ TEXT,
            travail_effectue TEXT,
            temps_passe TEXT,
            non_du_technicien TEXT,
            nom_du_signataire_ TEXT,
            pdf_url TEXT
        )`);
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'form-dimensions.html'));
});

app.post('/api/create-intervention-dimensions', (req, res) => {
    const {
        date_et_heure1, ref_cde_client, bon_de, client, tel_, adresse,
        mail, type_materiel_, n_de_matricule_, travail_effectue,
        temps_passe, non_du_technicien, nom_du_signataire_, signature
    } = req.body;

    const pdfFilename = `bon_${Date.now()}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    const pdfUrl = `/pdfs/${pdfFilename}`;

    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    doc.fontSize(20).text('Bon d\'Intervention', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Date / Heure : ${date_et_heure1 || ''}`);
    doc.text(`Type de Bon : ${bon_de || ''}`);
    doc.text(`Réf. Cde client : ${ref_cde_client || ''}`);
    doc.moveDown();

    doc.fontSize(14).text('Client :', { underline: true });
    doc.fontSize(12).text(`Nom : ${client || ''}`);
    doc.text(`Téléphone : ${tel_ || ''}`);
    doc.text(`Adresse : ${adresse || ''}`);
    doc.text(`E-mail : ${mail || ''}`);
    doc.moveDown();

    doc.fontSize(14).text('Matériel & Intervention :', { underline: true });
    doc.fontSize(12).text(`Type de Matériel : ${type_materiel_ || ''}`);
    doc.text(`N° de Matricule : ${n_de_matricule_ || ''}`);
    doc.text(`Travail Effectué :\n${travail_effectue || ''}`);
    doc.moveDown();

    doc.fontSize(14).text('Validation :', { underline: true });
    doc.fontSize(12).text(`Technicien : ${non_du_technicien || ''}`);
    doc.text(`Signataire : ${nom_du_signataire_ || ''}`);
    doc.text(`Temps passé : ${temps_passe || ''}`);

    if (signature && signature.startsWith('data:image/png;base64,')) {
        try {
            const base64Data = signature.replace(/^data:image\/png;base64,/, "");
            const sigBuffer = Buffer.from(base64Data, 'base64');
            doc.moveDown();
            doc.text('Signature du client :');
            doc.image(sigBuffer, { width: 150 });
        } catch (e) {
            console.error("Erreur lors de l'ajout de la signature au PDF", e);
        }
    }

    doc.end();

    writeStream.on('finish', () => {
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
            if (err) {
                return res.status(500).send("Erreur lors de l'enregistrement en base : " + err.message);
            }
            res.redirect('/historique.html');
        });
    });
});

app.get('/api/bons', (req, res) => {
    db.all("SELECT * FROM bons ORDER BY id DESC", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ bons: rows });
    });
});

app.get('/api/export-excel', async (req, res) => {
    db.all("SELECT * FROM bons ORDER BY id DESC", [], async (err, rows) => {
        if (err) {
            return res.status(500).send("Erreur lors de la récupération des données.");
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Historique Interventions");

        worksheet.columns = [
            { header: 'Lien PDF Signé', key: 'pdf_url', width: 25 },
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Date / Heure', key: 'date_et_heure1', width: 20 },
            { header: 'Réf. Cde', key: 'ref_cde_client', width: 15 },
            { header: 'Type de Bon', key: 'bon_de', width: 20 },
            { header: 'Client', key: 'client', width: 20 },
            { header: 'Téléphone', key: 'tel_', width: 15 },
            { header: 'Adresse', key: 'adresse', width: 25 },
            { header: 'E-mail', key: 'mail', width: 20 },
            { header: 'Matériel', key: 'type_materiel_', width: 15 },
            { header: 'Matricule', key: 'n_de_matricule_', width: 15 },
            { header: 'Travail Effectué', key: 'travail_effectue', width: 30 },
            { header: 'Temps Passé', key: 'temps_passe', width: 15 },
            { header: 'Technicien', key: 'non_du_technicien', width: 20 },
            { header: 'Signataire', key: 'nom_du_signataire_', width: 20 }
        ];

        rows.forEach(row => {
            worksheet.addRow(row);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=' + "historique_interventions.xlsx");

        await workbook.xlsx.write(res);
        res.end();
    });
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}[cite: 1]`);
});