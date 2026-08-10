const express = require('express');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const app = express();

// Permet de lire les données envoyées par Kizeo (au format JSON)
app.use(express.json());

// Route principale pour recevoir les données Kizeo (le Webhook)
app.post('/', async (req, res) => {
    try {
        // 1. Récupérer les données envoyées par Kizeo Forms
        const kizeoData = req.body;

        // 2. Lire le fichier modèle HTML
        let htmlTemplate = fs.readFileSync(path.join(__dirname, 'modele.html'), 'utf-8');

        // 3. Charger le logo PNG depuis le dossier public et le convertir en texte (Base64)
        // Cela garantit que l'image sera intégrée DIRECTEMENT dans le PDF sans problème de chemin
        const logoPath = path.join(__dirname, 'public', 'logo-enquete.png');
        if (fs.existsSync(logoPath)) {
            const logoBase64 = fs.readFileSync(logoPath).toString('base64');
            const logoSrc = `data:image/png;base64,${logoBase64}`;
            // Remplacer la balise {{logo_img}} par l'image
            htmlTemplate = htmlTemplate.replace('{{logo_img}}', logoSrc);
        } else {
            console.log("Attention : Le logo-enquete.png n'a pas été trouvé dans le dossier public.");
        }

        // 4. Remplacer automatiquement toutes les autres balises {{...}} par les données Kizeo
        for (const key in kizeoData) {
            // Cherche toutes les occurrences de la balise (ex: {{client}})
            const regex = new RegExp(`{{${key}}}`, 'g');
            htmlTemplate = htmlTemplate.replace(regex, kizeoData[key] || '');
        }
        
        // Nettoyer les balises qui seraient restées vides (si le technicien n'a rien rempli)
        htmlTemplate = htmlTemplate.replace(/{{.*?}}/g, '');

        // 5. Lancer Puppeteer (optimisé pour le serveur Render)
        const browser = await puppeteer.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Empêche le crash mémoire
                '--disable-gpu',           
                '--no-zygote',
                '--single-process'         // Processus ultra-léger
            ]
        });

        // 6. Créer la page et générer le PDF
        const page = await browser.newPage();
        await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({ 
            format: 'A4', 
            printBackground: true, // Très important pour imprimer les couleurs de fond et images
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });
        
        await browser.close();

        // 7. Renvoyer le PDF en réponse (ou le sauvegarder selon ton besoin)
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': pdfBuffer.length
        });
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Erreur lors de la création du PDF :", error);
        res.status(500).send("Erreur serveur lors de la création du PDF.");
    }
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré avec succès sur le port ${PORT}`);
});