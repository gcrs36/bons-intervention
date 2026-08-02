const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use('/outputs', express.static('outputs'));

const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error("Erreur d'ouverture de la base de données", err.message);
    } else {
        console.log("Connecté à la base de données SQLite.");
        db.run(`CREATE TABLE IF NOT EXISTS interventions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date_et_heure1 TEXT,
            ref_cde_client TEXT,
            client TEXT,
            adresse TEXT,
            tel TEXT,
            mail TEXT,
            mail2 TEXT,
            mail3 TEXT,
            mail4 TEXT,
            bon_de TEXT,
            type_materiel TEXT,
            n_de_matricule TEXT,
            travail_effectue TEXT,
            code TEXT,
            champ_de_saisie2 TEXT,
            champ_de_saisie4 TEXT,
            champ_de_saisie5 TEXT,
            total_h_t TEXT,
            repas TEXT,
            km TEXT,
            heures_d_arrivee TEXT,
            temps_passe TEXT,
            hotel TEXT,
            autoroute TEXT,
            heure_depart TEXT,
            deplacement TEXT,
            non_du_technicien TEXT,
            nom_du_signataire TEXT,
            bon_pour_accord TEXT,
            filepath TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

const transporter = nodemailer.createTransport({
    host: 'ssl0rices.ovh.net',
    port: 465,
    secure: true,
    auth: {
        user: 'votre-email@votre-domaine.com',
        pass: 'votre-mot-de-passe-email'
    }
});

// Route dédiée pour le formulaire Dimensions
app.post('/api/create-intervention-dimensions', (req, res) => {
    const {
        date_et_heure1, ref_cde_client, client, adresse, tel_, mail, mail2, mail3, mail4, bon_de,
        type_materiel_, n_de_matricule_, travail_effectue,
        code, champ_de_saisie2, champ_de_saisie4, champ_de_saisie5, total_h_t_,
        repas, km, heures_d_arrivee, temps_passe, hotel, autoroute, heure_depart, deplacement,
        non_du_technicien, nom_du_signataire_, bon_pour_accord, signature
    } = req.body;

    const templatePath = path.resolve(__dirname, 'models', 'modele.docx');
    if (!fs.existsSync(templatePath)) {
        return res.status(500).send("Erreur : Le fichier modele.docx est introuvable dans le dossier /models.");
    }

    try {
        const content = fs.readFileSync(templatePath, 'binary');
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

        doc.render({
            date_et_heure1: date_et_heure1 || "",
            ref_cde_client: ref_cde_client || "",
            client: client || "",
            adresse: adresse || "",
            tel_: tel_ || "",
            mail: mail || "",
            mail2: mail2 || "",
            mail3: mail3 || "",
            mail4: mail4 || "",
            bon_de: bon_de || "",
            type_materiel_: type_materiel_ || "",
            n_de_matricule_: n_de_matricule_ || "",
            travail_effectue: travail_effectue || "",
            code: code || "",
            champ_de_saisie2: champ_de_saisie2 || "",
            champ_de_saisie4: champ_de_saisie4 || "",
            champ_de_saisie5: champ_de_saisie5 || "",
            total_h_t_: total_h_t_ || "",
            repas: repas || "0",
            km: km || "0",
            heures_d_arrivee: heures_d_arrivee || "",
            temps_passe: temps_passe || "",
            hotel: hotel || "0",
            autoroute: autoroute || "0",
            heure_depart: heure_depart || "",
            deplacement: deplacement || "",
            non_du_technicien: non_du_technicien || "",
            nom_du_signataire_: nom_du_signataire_ || "",
            bon_pour_accord: bon_pour_accord ? "Oui" : "Non",
            signature: signature ? "[Image de signature]" : "Non signé"
        });

        const buf = doc.getZip().generate({ type: 'nodebuffer' });
        const filename = `intervention_dimensions_${Date.now()}.docx`;
        const outputPath = path.join(__dirname, 'outputs', filename);
        fs.writeFileSync(outputPath, buf);

        const query = `INSERT INTO interventions (
            date_et_heure1, ref_cde_client, client, adresse, tel, mail, mail2, mail3, mail4, bon_de, 
            type_materiel, n_de_matricule, travail_effectue, code, champ_de_saisie2, 
            champ_de_saisie4, champ_de_saisie5, total_h_t, repas, km, 
            heures_d_arrivee, temps_passe, hotel, autoroute, heure_depart, 
            deplacement, non_du_technicien, nom_du_signataire, bon_pour_accord, filepath
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        db.run(query, [
            date_et_heure1, ref_cde_client, client, adresse, tel_, mail, mail2, mail3, mail4, bon_de,
            type_materiel_, n_de_matricule_, travail_effectue, code, champ_de_saisie2,
            champ_de_saisie4, champ_de_saisie5, total_h_t_, repas, km,
            heures_d_arrivee, temps_passe, hotel, autoroute, heure_depart,
            deplacement, non_du_technicien, nom_du_signataire_, bon_pour_accord, `/outputs/${filename}`
        ], async function(err) {
            if (err) {
                console.error(err.message);
                return res.status(500).send("Erreur lors de l'enregistrement dans l'historique.");
            }

            // Envoi des e-mails en multi-destinataires
            let destinataires = [mail, mail2, mail3, mail4].filter(email => email && email.trim() !== "");

            if (destinataires.length > 0) {
                try {
                    await transporter.sendMail({
                        from: '"Dimensions Service Technique" <votre-email@votre-domaine.com>',
                        to: destinataires.join(', '),
                        subject: `Bon d'intervention - ${client}`,
                        text: `Bonjour,\n\nVeuillez trouver ci-joint votre bon d'intervention Dimensions.\n\nCordialement,\n${non_du_technicien}`,
                        attachments: [{ filename: `bon_intervention.docx`, path: outputPath }]
                    });
                } catch (mailError) {
                    console.error("Erreur d'envoi de mail :", mailError);
                }
            }

            res.redirect('/history.html');
        });

    } catch (error) {
        console.error(error);
        res.status(500).send("Erreur lors de la génération du document Word.");
    }
});

app.get('/api/interventions', (req, res) => {
    db.all(`SELECT * FROM interventions ORDER BY id DESC`, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ interventions: rows });
    });
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});