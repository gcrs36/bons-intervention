const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { DolibarrClient, DolibarrError, buildDolibarrFlow } = require('./lib/dolibarr');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const rootDir = __dirname;
const publicDir = path.join(rootDir, 'public');
const dataDir = path.resolve(process.env.DATA_DIR || rootDir);
const pdfDir = path.join(dataDir, 'pdfs');
const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, 'database.db'));

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(pdfDir, { recursive: true });

const db = new DatabaseSync(dbPath);
const dolibarr = new DolibarrClient({
  baseUrl: process.env.DOLIBARR_URL || 'https://dolibarr.gcrs.fr',
  apiKey: process.env.DOLIBARR_API_KEY || '',
  entity: process.env.DOLIBARR_ENTITY || '',
  vatRate: Number(process.env.DOLIBARR_VAT_RATE || 20),
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(optionalBasicAuth);
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(express.static(publicDir, { index: false }));

app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.get('/api/health', async (_req, res) => {
  const row = await dbGet('SELECT COUNT(*) AS total FROM bons');
  res.json({ ok: true, database: 'ok', interventions: row.total, dolibarrConfigured: dolibarr.isConfigured() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    dolibarr: {
      baseUrl: dolibarr.baseUrl,
      configured: dolibarr.isConfigured(),
      flow: ['intervention', 'commande_si_pieces', 'facture_brouillon'],
    },
    authenticationEnabled: Boolean(process.env.APP_USER && process.env.APP_PASSWORD),
  });
});

app.get('/api/dashboard', async (_req, res) => {
  const [totals, recent] = await Promise.all([
    dbGet(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'signed' THEN 1 ELSE 0 END) AS signed,
      SUM(CASE WHEN sync_state = 'synced' THEN 1 ELSE 0 END) AS synced,
      SUM(CASE WHEN sync_state = 'error' THEN 1 ELSE 0 END) AS sync_errors,
      SUM(CASE WHEN date(date_et_heure1) = date('now', 'localtime') THEN 1 ELSE 0 END) AS today
      FROM bons`),
    dbAll(`SELECT id, public_ref, date_et_heure1, client, bon_de, status, sync_state,
      dolibarr_intervention_id, dolibarr_order_id, dolibarr_invoice_id
      FROM bons ORDER BY id DESC LIMIT 6`),
  ]);
  res.json({ totals, recent, dolibarrConfigured: dolibarr.isConfigured() });
});

app.get('/api/bons', async (req, res) => {
  const conditions = [];
  const params = [];
  if (req.query.q) {
    conditions.push('(client LIKE ? OR public_ref LIKE ? OR ref_cde_client LIKE ? OR non_du_technicien LIKE ?)');
    const term = `%${String(req.query.q).slice(0, 100)}%`;
    params.push(term, term, term, term);
  }
  if (req.query.status) {
    conditions.push('status = ?');
    params.push(String(req.query.status));
  }
  if (req.query.sync) {
    conditions.push('sync_state = ?');
    params.push(String(req.query.sync));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const bons = await dbAll(`SELECT * FROM bons ${where} ORDER BY id DESC LIMIT ?`, [...params, limit]);
  res.json({ bons });
});

app.get('/api/bons/:id', async (req, res) => {
  const bon = await getBonWithItems(Number(req.params.id));
  if (!bon) return res.status(404).json({ error: 'Bon introuvable.' });
  res.json({ bon });
});

app.get('/api/bons/:id/pdf', async (req, res) => {
  const bon = await dbGet('SELECT pdf_url, pdf_filename FROM bons WHERE id = ?', [Number(req.params.id)]);
  if (!bon) return res.status(404).send('Bon introuvable.');
  const candidates = [
    bon.pdf_filename && path.join(pdfDir, path.basename(bon.pdf_filename)),
    bon.pdf_url && path.join(publicDir, bon.pdf_url.replace(/^\//, '')),
  ].filter(Boolean);
  const pdfPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!pdfPath) return res.status(404).send('PDF introuvable.');
  if (String(req.query.download || '') === '1') {
    return res.download(pdfPath, path.basename(bon.pdf_filename || pdfPath));
  }
  res.type('application/pdf').sendFile(pdfPath);
});

app.get('/api/dolibarr/status', async (_req, res) => {
  if (!dolibarr.isConfigured()) {
    return res.status(503).json({ ok: false, configured: false, message: 'Clé API non configurée.' });
  }
  try {
    await dolibarr.request('GET', 'thirdparties?limit=1&properties=id,name');
    res.json({ ok: true, configured: true, baseUrl: dolibarr.baseUrl });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, configured: true, message: safeError(error) });
  }
});

app.get('/api/dolibarr/thirdparties', async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 80);
  if (query.length < 2) return res.json({ thirdparties: [] });
  if (!dolibarr.isConfigured()) return res.status(503).json({ error: 'Connexion Dolibarr non configurée.' });
  try {
    const thirdparties = await dolibarr.searchThirdparties(query);
    res.json({ thirdparties });
  } catch (error) {
    res.status(error.status || 502).json({ error: safeError(error) });
  }
});

app.post('/api/create-intervention-dimensions', async (req, res) => {
  try {
    const payload = normalizeBonPayload(req.body);
    validateBonPayload(payload);

    const result = await dbRun(`INSERT INTO bons (
      date_et_heure1, ref_cde_client, bon_de, client, tel_, adresse, mail,
      type_materiel_, n_de_matricule_, travail_effectue, temps_passe,
      non_du_technicien, nom_du_signataire_, status, sync_state,
      heures_d_arrivee, heure_depart, repas, km, hotel, autoroute, deplacement,
      dolibarr_thirdparty_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`, [
      payload.date_et_heure1, payload.ref_cde_client, payload.bon_de, payload.client,
      payload.tel_, payload.adresse, payload.mail, payload.type_materiel_,
      payload.n_de_matricule_, payload.travail_effectue, payload.temps_passe,
      payload.non_du_technicien, payload.nom_du_signataire_,
      dolibarr.isConfigured() ? 'pending' : 'not_configured', payload.heures_d_arrivee,
      payload.heure_depart, payload.repas, payload.km, payload.hotel, payload.autoroute,
      payload.deplacement, payload.dolibarr_thirdparty_id,
    ]);

    const id = result.lastID;
    const publicRef = buildPublicRef(id, payload.date_et_heure1);
    await dbRun('UPDATE bons SET public_ref = ? WHERE id = ?', [publicRef, id]);
    for (const [index, item] of payload.items.entries()) {
      await dbRun(`INSERT INTO bon_items
        (bon_id, position, product_id, code, designation, unit_price, quantity, vat_rate, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        id, index + 1, item.product_id || null, item.code, item.designation,
        item.unit_price, item.quantity, item.vat_rate, item.line_total,
      ]);
    }

    const pdfFilename = `${publicRef}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    try {
      await generatePdf({ ...payload, id, public_ref: publicRef }, pdfPath);
    } catch (error) {
      await dbRun('DELETE FROM bon_items WHERE bon_id = ?', [id]);
      await dbRun('DELETE FROM bons WHERE id = ?', [id]);
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      throw error;
    }
    await dbRun('UPDATE bons SET pdf_filename = ?, pdf_url = ?, updated_at = datetime(\'now\') WHERE id = ?', [
      pdfFilename, `/api/bons/${id}/pdf`, id,
    ]);

    let sync = null;
    if (dolibarr.isConfigured() && String(req.body.sync_dolibarr || '1') !== '0') {
      try {
        sync = await syncBonToDolibarr(id);
      } catch (error) {
        sync = { ok: false, error: safeError(error) };
      }
    }

    if (wantsJson(req)) return res.status(201).json({ ok: true, id, publicRef, sync });
    res.redirect(`/historique.html?created=${id}`);
  } catch (error) {
    console.error('Création du bon :', error);
    if (wantsJson(req)) return res.status(error.status || 400).json({ error: safeError(error) });
    res.status(error.status || 400).send(`Impossible d'enregistrer le bon : ${escapeHtml(safeError(error))}`);
  }
});

app.post('/api/bons/:id/sync-dolibarr', async (req, res) => {
  if (!dolibarr.isConfigured()) {
    return res.status(503).json({ error: 'Configurez DOLIBARR_API_KEY sur Render avant la synchronisation.' });
  }
  try {
    const result = await syncBonToDolibarr(Number(req.params.id));
    res.json({ ok: true, result });
  } catch (error) {
    res.status(error.status || 502).json({ error: safeError(error) });
  }
});

app.get('/api/export-excel', async (_req, res) => {
  const bons = await dbAll('SELECT * FROM bons ORDER BY id DESC');
  const items = await dbAll(`SELECT i.*, b.public_ref FROM bon_items i
    JOIN bons b ON b.id = i.bon_id ORDER BY i.bon_id DESC, i.position ASC`);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GCRS Interventions';
  const interventions = workbook.addWorksheet('Interventions');
  interventions.columns = [
    ['Référence', 'public_ref', 18], ['Date', 'date_et_heure1', 20], ['Client', 'client', 28],
    ['Type', 'bon_de', 22], ['Matériel', 'type_materiel_', 22], ['Matricule', 'n_de_matricule_', 18],
    ['Technicien', 'non_du_technicien', 22], ['Temps', 'temps_passe', 12], ['Statut', 'status', 14],
    ['Synchronisation', 'sync_state', 18], ['Intervention Dolibarr', 'dolibarr_intervention_id', 20],
    ['Commande Dolibarr', 'dolibarr_order_id', 18], ['Facture Dolibarr', 'dolibarr_invoice_id', 18],
  ].map(([header, key, width]) => ({ header, key, width }));
  interventions.addRows(bons.map((bon) => ({
    ...bon,
    date_et_heure1: excelWallClockDate(bon.date_et_heure1),
  })));
  interventions.getColumn('date_et_heure1').numFmt = 'dd/mm/yyyy hh:mm';
  styleWorksheet(interventions);

  const lines = workbook.addWorksheet('Pièces');
  lines.columns = [
    ['Bon', 'public_ref', 18], ['Code', 'code', 16], ['Désignation', 'designation', 36],
    ['Prix HT', 'unit_price', 14], ['Quantité', 'quantity', 12], ['TVA', 'vat_rate', 10],
    ['Total HT', 'line_total', 14],
  ].map(([header, key, width]) => ({ header, key, width }));
  lines.addRows(items);
  lines.getColumn('unit_price').numFmt = '#,##0.00 €';
  lines.getColumn('line_total').numFmt = '#,##0.00 €';
  styleWorksheet(lines);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="interventions-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

async function initializeDatabase() {
  await dbExec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS bons (
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
    );
    CREATE TABLE IF NOT EXISTS bon_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bon_id INTEGER NOT NULL REFERENCES bons(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 1,
      product_id INTEGER,
      code TEXT,
      designation TEXT NOT NULL,
      unit_price REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 1,
      vat_rate REAL NOT NULL DEFAULT 20,
      line_total REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bon_id INTEGER NOT NULL REFERENCES bons(id) ON DELETE CASCADE,
      step TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureColumns('bons', {
    public_ref: 'TEXT', status: "TEXT NOT NULL DEFAULT 'signed'", sync_state: "TEXT NOT NULL DEFAULT 'not_configured'",
    sync_error: 'TEXT', sync_at: 'TEXT', pdf_filename: 'TEXT', heures_d_arrivee: 'TEXT', heure_depart: 'TEXT',
    repas: 'REAL NOT NULL DEFAULT 0', km: 'REAL NOT NULL DEFAULT 0', hotel: 'REAL NOT NULL DEFAULT 0',
    autoroute: 'REAL NOT NULL DEFAULT 0', deplacement: 'TEXT', dolibarr_thirdparty_id: 'INTEGER',
    dolibarr_intervention_id: 'INTEGER', dolibarr_order_id: 'INTEGER', dolibarr_invoice_id: 'INTEGER',
    dolibarr_pdf_uploaded: 'INTEGER NOT NULL DEFAULT 0', created_at: 'TEXT', updated_at: 'TEXT',
  });
  await dbRun(`UPDATE bons SET public_ref = printf('BI-%05d', id) WHERE public_ref IS NULL OR public_ref = ''`);
  await dbRun(`UPDATE bons SET created_at = COALESCE(created_at, datetime('now')), updated_at = COALESCE(updated_at, datetime('now'))`);
}

async function syncBonToDolibarr(id) {
  const bon = await getBonWithItems(id);
  if (!bon) throw httpError(404, 'Bon introuvable.');
  await dbRun("UPDATE bons SET sync_state = 'syncing', sync_error = NULL, updated_at = datetime('now') WHERE id = ?", [id]);
  await logSync(id, 'start', 'info', 'Synchronisation démarrée.');

  try {
    const result = await buildDolibarrFlow({
      client: dolibarr,
      bon,
      pdfPath: resolvePdfPath(bon),
      onProgress: async (step, values, message) => {
        const allowed = {
          thirdparty: 'dolibarr_thirdparty_id', intervention: 'dolibarr_intervention_id',
          order: 'dolibarr_order_id', invoice: 'dolibarr_invoice_id', pdf: 'dolibarr_pdf_uploaded',
        };
        if (allowed[step] && values?.id !== undefined) {
          await dbRun(`UPDATE bons SET ${allowed[step]} = ?, updated_at = datetime('now') WHERE id = ?`, [values.id, id]);
          bon[allowed[step]] = values.id;
        }
        await logSync(id, step, 'info', message);
      },
    });
    await dbRun("UPDATE bons SET sync_state = 'synced', sync_at = datetime('now'), sync_error = NULL, updated_at = datetime('now') WHERE id = ?", [id]);
    await logSync(id, 'complete', 'success', 'Synchronisation terminée.');
    return result;
  } catch (error) {
    const message = safeError(error);
    await dbRun("UPDATE bons SET sync_state = 'error', sync_error = ?, updated_at = datetime('now') WHERE id = ?", [message.slice(0, 1000), id]);
    await logSync(id, 'error', 'error', message);
    throw error;
  }
}

async function generatePdf(bon, outputPath) {
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 0,
      info: { Title: `Bon d'intervention ${bon.public_ref}`, Author: 'GCRS Interventions' },
    });
    const output = fs.createWriteStream(outputPath);
    output.on('finish', resolve);
    output.on('error', reject);
    doc.on('error', reject);
    doc.pipe(output);

    const black = '#000000';
    const left = 54;
    const width = 487.25;
    const logoPath = path.join(publicDir, 'logo-enquete.png');
    const pt = (inches) => inches * 72;
    const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

    function drawCell(x, y, cellWidth, height, value, options = {}) {
      const padding = options.padding ?? 4;
      doc.save().lineWidth(0.25).strokeColor(black).rect(x, y, cellWidth, height).stroke().restore();
      doc.fillColor(black).font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 8)
        .text(cleanText(value), x + padding, y + padding, {
          width: Math.max(cellWidth - (padding * 2), 1), height: Math.max(height - (padding * 2), 1),
          align: options.align || 'left', valign: 'center', ellipsis: true, lineGap: 0,
        });
    }

    function drawRows(x, y, columnWidths, rows) {
      let cursorY = y;
      for (const row of rows) {
        let cursorX = x;
        row.cells.forEach((cell, index) => {
          drawCell(cursorX, cursorY, columnWidths[index], row.height, cell.value, cell.options);
          cursorX += columnWidths[index];
        });
        cursorY += row.height;
      }
      return cursorY;
    }

    function drawHeader() {
      if (fs.existsSync(logoPath)) {
        try { doc.image(logoPath, left, pt(0.82), { fit: [pt(3.95), pt(0.68)], align: 'left', valign: 'center' }); } catch { /* logo facultatif */ }
      }
      doc.fillColor(black).font('Helvetica').fontSize(6)
        .text('Machines et fournitures pour le façonnage et le pelliculage', left, pt(1.55), { width: pt(3.95), align: 'center' });
      doc.fontSize(8).text([
        'Parc d’Activités Les Portes du Dauphiné',
        'Rue Ampère - 69780 SAINT PIERRE DE CHANDIEU',
        'Tél. 04.78.40.26.32 - Fax. 04.78.40.25.83',
        'Web: www.dimension.fr - EMAIL: commercial@dimensions.fr',
        'N° TVA Intracommunautaire FR.15.320.860.869',
      ].join('\n'), pt(4.69), pt(0.83), { width: pt(2.82), height: pt(0.9), align: 'center', lineGap: 0.5 });
    }

    function drawPiecesTable(items, startY, availableHeight = 59.2) {
      const columns = [61.1, 260.1, 40.4, 47.8, 77.85];
      const labels = ['CODE', 'DÉSIGNATION', 'PRIX', 'QTÉ', 'TOTAL H.T.'];
      let x = left;
      labels.forEach((label, index) => {
        drawCell(x, startY, columns[index], 14.75, label, { bold: true, align: 'center', size: 8, padding: 2 });
        x += columns[index];
      });
      const visible = items.slice(0, 2);
      const rowCount = Math.max(visible.length, 2);
      const rowHeight = availableHeight / rowCount;
      for (let row = 0; row < rowCount; row += 1) {
        const item = visible[row] || {};
        const values = item.designation || item.code ? [
          item.code || '', item.designation || '', money(item.unit_price), number(item.quantity), money(item.line_total),
        ] : ['', '', '', '', ''];
        x = left;
        values.forEach((value, index) => {
          drawCell(x, startY + 14.75 + (row * rowHeight), columns[index], rowHeight, value, {
            align: index >= 2 ? 'right' : 'left', size: 8, padding: 4,
          });
          x += columns[index];
        });
      }
      return startY + 14.75 + availableHeight;
    }

    drawHeader();

    const clientY = pt(2.331);
    const half = width / 2;
    drawRows(left, clientY, [half, half], [
      { height: 21.85, cells: [{ value: `Date: ${formatDateTime(bon.date_et_heure1)}` }, { value: `Client : ${bon.client || ''}` }] },
      { height: 21.85, cells: [{ value: `Réf. Cde client : ${bon.ref_cde_client || ''}` }, { value: `Adresse : ${bon.adresse || ''}` }] },
      { height: 21.85, cells: [{ value: `Tél : ${bon.tel_ || ''}` }, { value: `@ Mail: ${bon.mail || ''}` }] },
    ]);

    const bonY = pt(3.127);
    drawRows(left, bonY, [width], [
      { height: 23.2, cells: [{ value: 'BON DE :', options: { bold: true, align: 'center', size: 8 } }] },
      { height: 23.2, cells: [{ value: bon.bon_de || '', options: { align: 'center', size: 8 } }] },
    ]);

    const workY = pt(3.848);
    const typeWidth = width * (6409 / 10458);
    drawCell(left, workY, typeWidth, 22.7, `TYPE MATÉRIEL: ${bon.type_materiel_ || ''}`, { size: 8 });
    drawCell(left + typeWidth, workY, width - typeWidth, 22.7, `N° matricule: ${bon.n_de_matricule_ || ''}`, { size: 8 });
    drawCell(left, workY + 22.7, width, 28, `TRAVAIL EFFECTUÉ: ${bon.travail_effectue || ''}`, { size: 8 });

    doc.fillColor(black).font('Helvetica-Bold').fontSize(8)
      .text('PIÈCES ET FOURNITURES :', left, pt(5.62), { width });
    const items = Array.isArray(bon.items) ? bon.items : [];
    const expensesY = drawPiecesTable(items, pt(5.846));
    const expenseColumns = [126.1, 95.3, 125.1, 140.75];
    drawRows(left, expensesY, expenseColumns, [
      { height: 22.1, cells: [
        { value: `REPAS: ${number(bon.repas)}` }, { value: `KM: ${number(bon.km)}` },
        { value: `Heure d’arrivée: ${bon.heures_d_arrivee || ''}` }, { value: `TEMPS PASSÉ ${bon.temps_passe || ''}` },
      ] },
      { height: 21.75, cells: [
        { value: `HÔTEL: ${number(bon.hotel)}` }, { value: `Autoroute: ${money(bon.autoroute)}` },
        { value: `Heure départ: ${bon.heure_depart || ''}` }, { value: `DÉPLACEMENT ${bon.deplacement || ''}` },
      ] },
    ]);

    const signatureY = pt(9.57);
    drawCell(left, signatureY, half, 21.25, `Nom du technicien: ${bon.non_du_technicien || ''}`, { size: 9 });
    drawCell(left + half, signatureY, half, 21.25, `Nom du signataire: ${bon.nom_du_signataire_ || ''}`, { size: 9 });
    const signatureHeight = 43;
    drawCell(left, signatureY + 21.25, width, signatureHeight, 'Bon pour accord', { align: 'center', size: 9, padding: 4 });
    if (bon.signature) {
      try {
        const signatureBuffer = Buffer.from(String(bon.signature).split(',')[1], 'base64');
        doc.image(signatureBuffer, left + 8, signatureY + 33, { fit: [width - 16, 28], align: 'center', valign: 'center' });
      } catch { /* La présence du libellé conserve la zone si l'image est illisible. */ }
    }

    const legalY = pt(10.62);
    doc.save().lineWidth(0.25).strokeColor(black).rect(left, legalY, width, 26).stroke().restore();
    doc.fillColor(black).font('Helvetica').fontSize(5.5).text(
      'Je déclare avoir pris connaissance et rester en possession d’un exemplaire des conditions générales de ventes au verso du présent document et les accepte dans leur intégralité.\nLa clause de réserve de propriété des marchandises vendues n’interviendra qu’après parfait paiement du prix convenu (Loi N° 80-335 du 12 mai 1980).',
      left + 4, legalY + 3, { width: width - 8, height: 20, lineGap: 0.3, align: 'left', ellipsis: true },
    );

    if (items.length > 2) {
      doc.addPage({ size: 'A4', margin: 0 });
      drawHeader();
      doc.fillColor(black).font('Helvetica-Bold').fontSize(10)
        .text('PIÈCES ET FOURNITURES - SUITE', left, pt(2.2), { width, align: 'center' });
      const continuation = items.slice(2);
      const columns = [61.1, 260.1, 40.4, 47.8, 77.85];
      const labels = ['CODE', 'DÉSIGNATION', 'PRIX', 'QTÉ', 'TOTAL H.T.'];
      let cursorY = pt(2.55);
      let cursorX = left;
      labels.forEach((label, index) => {
        drawCell(cursorX, cursorY, columns[index], 18, label, { bold: true, align: 'center', size: 8, padding: 3 });
        cursorX += columns[index];
      });
      cursorY += 18;
      continuation.forEach((item) => {
        cursorX = left;
        [item.code || '', item.designation || '', money(item.unit_price), number(item.quantity), money(item.line_total)]
          .forEach((value, index) => {
            drawCell(cursorX, cursorY, columns[index], 28, value, { align: index >= 2 ? 'right' : 'left', size: 8 });
            cursorX += columns[index];
          });
        cursorY += 28;
      });
    }
    doc.end();
  });
}

function normalizeBonPayload(body) {
  let parsedItems = [];
  try { parsedItems = Array.isArray(body.items) ? body.items : JSON.parse(body.items || '[]'); } catch { parsedItems = []; }
  if (!parsedItems.length && (body.code || body.champ_de_saisie2)) {
    parsedItems = [{ code: body.code, designation: body.champ_de_saisie2, unit_price: body.champ_de_saisie4, quantity: body.champ_de_saisie5, vat_rate: 20 }];
  }
  const items = parsedItems.filter((item) => String(item.designation || item.code || '').trim()).map((item) => {
    const unitPrice = toNumber(item.unit_price ?? item.price);
    const quantity = Math.max(toNumber(item.quantity ?? item.qty) || 1, 0);
    return {
      product_id: Number(item.product_id) || null,
      code: clean(item.code, 80), designation: clean(item.designation, 500),
      unit_price: unitPrice, quantity, vat_rate: Math.max(toNumber(item.vat_rate) || 20, 0),
      line_total: roundMoney(unitPrice * quantity),
    };
  });
  return {
    date_et_heure1: clean(body.date_et_heure1, 32), ref_cde_client: clean(body.ref_cde_client, 100),
    bon_de: clean(body.bon_de, 80), client: clean(body.client, 200), tel_: clean(body.tel_, 60),
    adresse: clean(body.adresse, 1000), mail: clean(body.mail, 254), type_materiel_: clean(body.type_materiel_, 200),
    n_de_matricule_: clean(body.n_de_matricule_, 150), travail_effectue: clean(body.travail_effectue, 10000),
    temps_passe: clean(body.temps_passe, 30), non_du_technicien: clean(body.non_du_technicien, 150),
    nom_du_signataire_: clean(body.nom_du_signataire_, 150), signature: validSignature(body.signature),
    bon_pour_accord: String(body.bon_pour_accord || '') === '1', heures_d_arrivee: clean(body.heures_d_arrivee, 8),
    heure_depart: clean(body.heure_depart, 8), repas: toNumber(body.repas), km: toNumber(body.km),
    hotel: toNumber(body.hotel), autoroute: toNumber(body.autoroute), deplacement: clean(body.deplacement, 500),
    dolibarr_thirdparty_id: Number(body.dolibarr_thirdparty_id) || null, items,
  };
}

function validateBonPayload(payload) {
  const required = [['date_et_heure1', 'La date'], ['client', 'Le client'], ['bon_de', 'Le type de bon'],
    ['travail_effectue', 'Le travail effectué'], ['non_du_technicien', 'Le technicien'], ['nom_du_signataire_', 'Le signataire']];
  for (const [key, label] of required) if (!payload[key]) throw httpError(400, `${label} est obligatoire.`);
  if (!payload.bon_pour_accord) throw httpError(400, "L'accord du client est obligatoire.");
  if (!payload.signature) throw httpError(400, 'La signature du client est obligatoire.');
  if (payload.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.mail)) throw httpError(400, "L'adresse e-mail n'est pas valide.");
}

function optionalBasicAuth(req, res, next) {
  const user = process.env.APP_USER;
  const password = process.env.APP_PASSWORD;
  if (!user || !password || req.path === '/api/health') return next();
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const [candidateUser, candidatePassword] = Buffer.from(header.slice(6), 'base64').toString().split(':');
    if (safeEqual(candidateUser, user) && safeEqual(candidatePassword, password)) return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="GCRS Interventions", charset="UTF-8"');
  res.status(401).send('Authentification requise.');
}

function safeEqual(left = '', right = '') {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function getBonWithItems(id) {
  const bon = await dbGet('SELECT * FROM bons WHERE id = ?', [id]);
  if (!bon) return null;
  bon.items = await dbAll('SELECT * FROM bon_items WHERE bon_id = ? ORDER BY position ASC', [id]);
  return bon;
}

function resolvePdfPath(bon) {
  const candidates = [bon.pdf_filename && path.join(pdfDir, path.basename(bon.pdf_filename)), bon.pdf_url && path.join(publicDir, bon.pdf_url.replace(/^\//, ''))].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildPublicRef(id, dateValue) {
  const date = new Date(dateValue || Date.now());
  const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
  return `BI-${year}-${String(id).padStart(5, '0')}`;
}

function styleWorksheet(sheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(sheet.columnCount).address };
  const header = sheet.getRow(1);
  header.height = 24;
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const cell = header.getCell(column);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173B57' } };
    cell.alignment = { vertical: 'middle' };
  }
}

function dbRun(sql, params = []) {
  const result = db.prepare(sql).run(...params);
  return Promise.resolve({ lastID: Number(result.lastInsertRowid), changes: Number(result.changes) });
}
function dbGet(sql, params = []) { return Promise.resolve(db.prepare(sql).get(...params)); }
function dbAll(sql, params = []) { return Promise.resolve(db.prepare(sql).all(...params)); }
function dbExec(sql) { db.exec(sql); return Promise.resolve(); }

async function ensureColumns(table, columns) {
  const existing = new Set((await dbAll(`PRAGMA table_info(${table})`)).map((column) => column.name));
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) await dbRun(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function logSync(bonId, step, level, message) {
  return dbRun('INSERT INTO sync_events (bon_id, step, level, message) VALUES (?, ?, ?, ?)', [bonId, step, level, String(message).slice(0, 2000)]);
}

function wantsJson(req) { return req.is('application/json') || String(req.headers.accept || '').includes('application/json'); }
function clean(value, max) { return String(value || '').trim().slice(0, max); }
function toNumber(value) { const parsed = Number(String(value ?? 0).replace(',', '.')); return Number.isFinite(parsed) ? parsed : 0; }
function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function number(value) { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(value) || 0); }
function money(value) { return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)} €`; }
function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value || '') : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(date); }
function excelWallClockDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))) : null;
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function nl2br(value) { return escapeHtml(value || '').replace(/\n/g, '<br>'); }
function validSignature(value) { const signature = String(value || ''); return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) && signature.length < 3_000_000 ? signature : ''; }
function safeError(error) { return error instanceof DolibarrError ? error.message : String(error?.message || error || 'Erreur inconnue'); }
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

initializeDatabase()
  .then(() => app.listen(PORT, () => console.log(`GCRS Interventions disponible sur le port ${PORT}`)))
  .catch((error) => { console.error('Initialisation impossible :', error); process.exitCode = 1; });

module.exports = { app, db, initializeDatabase, normalizeBonPayload, buildPublicRef };
