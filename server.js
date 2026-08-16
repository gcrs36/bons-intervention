const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { DolibarrClient, DolibarrError, buildDolibarrFlow } = require('./lib/dolibarr');
const { BON_TYPES, publicBonTypes, getBonType } = require('./lib/bon-types');
const { generateGenericPdf } = require('./lib/pdf-generic');

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
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
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

app.get('/api/bon-types', (_req, res) => res.json(publicBonTypes()));

app.get('/api/dashboard', async (_req, res) => {
  const [totals, recent] = await Promise.all([
    dbGet(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'signed' THEN 1 ELSE 0 END) AS signed,
      SUM(CASE WHEN sync_state = 'synced' THEN 1 ELSE 0 END) AS synced,
      SUM(CASE WHEN sync_state = 'error' THEN 1 ELSE 0 END) AS sync_errors,
      SUM(CASE WHEN date(date_et_heure1) = date('now', 'localtime') THEN 1 ELSE 0 END) AS today
      FROM bons`),
    dbAll(`SELECT id, public_ref, date_et_heure1, client, bon_de, bon_type, bon_variant, status, sync_state,
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
  if (req.query.variant) {
    conditions.push('bon_variant = ?');
    params.push(String(req.query.variant));
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
    if (await respondWithExistingRequest(req, res, payload.client_request_id)) return;

    const result = await dbRun(`INSERT INTO bons (
      date_et_heure1, ref_cde_client, bon_de, client, tel_, adresse, mail,
      type_materiel_, n_de_matricule_, travail_effectue, temps_passe,
      non_du_technicien, nom_du_signataire_, status, sync_state,
      heures_d_arrivee, heure_depart, repas, km, hotel, autoroute, deplacement,
      dolibarr_thirdparty_id, client_request_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`, [
      payload.date_et_heure1, payload.ref_cde_client, payload.bon_de, payload.client,
      payload.tel_, payload.adresse, payload.mail, payload.type_materiel_,
      payload.n_de_matricule_, payload.travail_effectue, payload.temps_passe,
      payload.non_du_technicien, payload.nom_du_signataire_,
      dolibarr.isConfigured() ? 'pending' : 'not_configured', payload.heures_d_arrivee,
      payload.heure_depart, payload.repas, payload.km, payload.hotel, payload.autoroute,
      payload.deplacement, payload.dolibarr_thirdparty_id, payload.client_request_id,
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

app.post('/api/create-bon', async (req, res) => {
  try {
    const payload = normalizeGenericPayload(req.body);
    validateGenericPayload(payload);
    if (await respondWithExistingRequest(req, res, payload.client_request_id)) return;

    const result = await dbRun(`INSERT INTO bons (
      date_et_heure1, ref_cde_client, bon_de, client, tel_, adresse, mail,
      type_materiel_, n_de_matricule_, travail_effectue, temps_passe,
      non_du_technicien, nom_du_signataire_, status, sync_state,
      heures_d_arrivee, heure_depart, repas, km, hotel, autoroute, deplacement,
      dolibarr_thirdparty_id, bon_type, bon_variant, extra_json, client_request_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`, [
      payload.date_et_heure1, payload.ref_cde_client, payload.bon_de, payload.client,
      payload.tel_, payload.adresse, payload.mail, payload.type_materiel_,
      payload.n_de_matricule_, payload.travail_effectue, payload.temps_passe,
      payload.non_du_technicien, payload.nom_du_signataire_,
      dolibarr.isConfigured() ? 'pending' : 'not_configured', payload.heures_d_arrivee,
      payload.heure_depart, payload.repas, payload.km, payload.hotel, payload.autoroute,
      payload.deplacement, payload.dolibarr_thirdparty_id, payload.bon_type,
      payload.bon_variant, JSON.stringify(payload.extra), payload.client_request_id,
    ]);

    const id = result.lastID;
    const publicRef = buildPublicRef(id, payload.date_et_heure1, payload.bon_type);
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
      if (payload.definition.family === 'intervention' && payload.bon_variant === 'dimensions') {
        await generatePdf({ ...payload, id, public_ref: publicRef }, pdfPath);
      } else {
        await generateGenericPdf({ ...payload, id, public_ref: publicRef }, pdfPath);
      }
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
    if (dolibarr.isConfigured() && String(req.body.sync_dolibarr ?? (payload.definition.syncDefault ? '1' : '0')) !== '0') {
      try {
        sync = await syncBonToDolibarr(id);
      } catch (error) {
        sync = { ok: false, error: safeError(error) };
      }
    }

    if (wantsJson(req)) return res.status(201).json({ ok: true, id, publicRef, sync });
    res.redirect(`/historique.html?created=${id}`);
  } catch (error) {
    console.error('Création du bon multi-formulaire :', error);
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
    ['Référence', 'public_ref', 18], ['Famille', 'bon_type', 20], ['Variante', 'bon_variant', 14],
    ['Date', 'date_et_heure1', 20], ['Client', 'client', 28],
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
    dolibarr_pdf_uploaded: 'INTEGER NOT NULL DEFAULT 0', bon_type: "TEXT NOT NULL DEFAULT 'intervention'",
    bon_variant: "TEXT NOT NULL DEFAULT 'dimensions'", extra_json: 'TEXT', client_request_id: 'TEXT', created_at: 'TEXT', updated_at: 'TEXT',
  });
  await dbExec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bons_client_request_id ON bons(client_request_id) WHERE client_request_id IS NOT NULL');
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
    const logoPath = path.join(publicDir, 'logo-dimensions.png');
    const pt = (inches) => inches * 72;
    const cm = (centimeters) => (centimeters * 72) / 2.54;
    const cleanText = (value) => String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    function drawCell(x, y, cellWidth, height, value, options = {}) {
      const padding = options.padding ?? 4;
      doc.save().lineWidth(0.25).strokeColor(black).rect(x, y, cellWidth, height).stroke().restore();
      doc.fillColor(black).font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 8)
        .text(cleanText(value), x + padding, y + padding, {
          width: Math.max(cellWidth - (padding * 2), 1), height: Math.max(height - (padding * 2), 1),
          align: options.align || 'left', valign: 'center', ellipsis: true, lineGap: 0,
        });
    }

    function measureCellHeight(cellWidth, value, options = {}, minimumHeight = 0) {
      const padding = options.padding ?? 4;
      doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 8);
      const textHeight = doc.heightOfString(cleanText(value), {
        width: Math.max(cellWidth - (padding * 2), 1),
        align: options.align || 'left', lineGap: 0,
      });
      return Math.max(minimumHeight, Math.ceil(textHeight + (padding * 2)));
    }

    function adaptiveRowHeight(columnWidths, cells, minimumHeight = 0) {
      return cells.reduce((height, cell, index) => Math.max(
        height,
        measureCellHeight(columnWidths[index], cell.value, cell.options, minimumHeight),
      ), minimumHeight);
    }

    function drawAdaptiveRow(x, y, columnWidths, cells, minimumHeight = 0) {
      const height = adaptiveRowHeight(columnWidths, cells, minimumHeight);
      let cursorX = x;
      cells.forEach((cell, index) => {
        drawCell(cursorX, y, columnWidths[index], height, cell.value, cell.options);
        cursorX += columnWidths[index];
      });
      return { height, bottom: y + height };
    }

    function drawHeader() {
      if (fs.existsSync(logoPath)) {
        try { doc.image(logoPath, pt(0.743), pt(0.787), { fit: [pt(3.947), pt(0.986)], align: 'left', valign: 'center' }); } catch { /* logo facultatif */ }
      }
      doc.fillColor(black).font('Helvetica').fontSize(6)
        .text('Machines et fournitures pour le façonnage et le pelliculage', pt(0.743), pt(1.82), { width: pt(3.947), align: 'center' });
      doc.fontSize(8).text([
        'Parc d’Activités Les Portes du Dauphiné',
        'Rue Ampère - 69780 SAINT PIERRE DE CHANDIEU',
        'Tél. 04.78.40.26.32 - Fax. 04.78.40.25.83',
        'Web: www.dimension.fr - EMAIL: commercial@dimensions.fr',
        'N° TVA Intracommunautaire FR.15.320.860.869',
      ].join('\n'), pt(4.69), pt(0.83), { width: pt(2.82), height: pt(0.9), align: 'center', lineGap: 0.5 });
    }

    function drawPiecesTable(items, startY) {
      const columns = [61.1, 260.1, 40.4, 47.8, 77.85];
      const labels = ['CODE', 'DÉSIGNATION', 'PRIX', 'QTÉ', 'TOTAL H.T.'];
      const pageBottom = doc.page.height - 54;
      const rows = items.length ? items : [{}];
      let cursorY = startY;
      const drawTableHeader = () => {
        const header = drawAdaptiveRow(left, cursorY, columns, labels.map((label) => ({
          value: label, options: { bold: true, align: 'center', size: 8, padding: 2 },
        })), 14.75);
        cursorY = header.bottom;
      };
      drawTableHeader();
      for (const item of rows) {
        const values = item.designation || item.code ? [
          item.code || '', item.designation || '', money(item.unit_price), number(item.quantity), money(item.line_total),
        ] : ['', '', '', '', ''];
        const cells = values.map((value, index) => ({
          value, options: { align: index >= 2 ? 'right' : 'left', size: 8, padding: 4 },
        }));
        const requiredHeight = adaptiveRowHeight(columns, cells, 22);
        if (cursorY + requiredHeight > pageBottom) {
          doc.addPage({ size: 'A4', margin: 0 });
          drawHeader();
          doc.fillColor(black).font('Helvetica-Bold').fontSize(10)
            .text('PIÈCES ET FOURNITURES - SUITE', left, pt(2.2), { width, align: 'center' });
          cursorY = pt(2.55);
          drawTableHeader();
        }
        const result = drawAdaptiveRow(left, cursorY, columns, cells, 22);
        cursorY = result.bottom;
      }
      return cursorY;
    }

    drawHeader();

    const clientY = pt(2.331);
    const half = width / 2;
    const clientRows = [
      [
        { value: `Date: ${formatDateTime(bon.date_et_heure1)}`, options: { padding: 2 } },
        { value: `Client : ${bon.client || ''}`, options: { padding: 2 } },
      ],
      [
        { value: `Réf. Cde client : ${bon.ref_cde_client || ''}`, options: { padding: 2 } },
        { value: `Adresse : ${bon.adresse || ''}`, options: { padding: 2 } },
      ],
      [
        { value: `Tél : ${bon.tel_ || ''}`, options: { padding: 2 } },
        { value: `@ Mail: ${bon.mail || ''}`, options: { padding: 2 } },
      ],
    ];
    let clientBottom = clientY;
    clientRows.forEach((cells) => { clientBottom = drawAdaptiveRow(left, clientBottom, [half, half], cells, 14.75).bottom; });

    const bonY = Math.max(pt(3.127), clientBottom + 13);
    const bonTitle = drawAdaptiveRow(left, bonY, [width], [
      { value: 'BON DE :', options: { bold: true, align: 'center', size: 8, padding: 2 } },
    ], 14.75);
    const bonValue = drawAdaptiveRow(left, bonTitle.bottom, [width], [
      { value: bon.bon_de || '', options: { align: 'center', size: 8, padding: 2 } },
    ], 14.75);

    const workY = Math.max(pt(3.848), bonValue.bottom + 22);
    const typeWidth = width * (6409 / 10458);
    const materialRow = drawAdaptiveRow(left, workY, [typeWidth, width - typeWidth], [
      { value: `TYPE MATÉRIEL: ${bon.type_materiel_ || ''}`, options: { size: 8 } },
      { value: `N° matricule: ${bon.n_de_matricule_ || ''}`, options: { size: 8 } },
    ], 22.7);
    const workText = `TRAVAIL EFFECTUÉ: ${bon.travail_effectue || ''}`;
    const maximumWorkHeight = Math.max(28, pt(7.2) - materialRow.bottom);
    const workHeight = Math.min(measureCellHeight(width, workText, { size: 8 }, 28), maximumWorkHeight);
    const workBottom = materialRow.bottom + workHeight;
    drawCell(left, materialRow.bottom, width, workHeight, workText, { size: 8 });

    const piecesLabelY = Math.max(pt(5.62), workBottom + 18);
    doc.fillColor(black).font('Helvetica-Bold').fontSize(8)
      .text('PIÈCES ET FOURNITURES :', left, piecesLabelY, { width });
    const items = Array.isArray(bon.items) ? bon.items : [];
    let expensesY = drawPiecesTable(items, piecesLabelY + pt(0.226));
    const expenseColumns = [126.1, 95.3, 125.1, 140.75];
    const expenseRows = [
      { minimumHeight: 22.1, cells: [
        { value: `REPAS: ${number(bon.repas)}` }, { value: `KM: ${number(bon.km)}` },
        { value: `Heure d’arrivée: ${bon.heures_d_arrivee || ''}` }, { value: `TEMPS PASSÉ ${bon.temps_passe || ''}` },
      ] },
      { minimumHeight: 21.75, cells: [
        { value: `HÔTEL: ${number(bon.hotel)}` }, { value: `Autoroute: ${money(bon.autoroute)}` },
        { value: `Heure départ: ${bon.heure_depart || ''}` }, { value: `DÉPLACEMENT ${bon.deplacement || ''}` },
      ] },
    ];
    const expenseHeights = expenseRows.map((row) => adaptiveRowHeight(expenseColumns, row.cells, row.minimumHeight));
    const expensesRequiredHeight = expenseHeights.reduce((sum, height) => sum + height, 0);
    if (expensesY + expensesRequiredHeight > doc.page.height - 54) {
      doc.addPage({ size: 'A4', margin: 0 });
      drawHeader();
      doc.fillColor(black).font('Helvetica-Bold').fontSize(10)
        .text('FRAIS ET DÉPLACEMENT', left, pt(2.2), { width, align: 'center' });
      expensesY = pt(2.55);
    }
    let expenseBottom = expensesY;
    expenseRows.forEach((row) => {
      expenseBottom = drawAdaptiveRow(left, expenseBottom, expenseColumns, row.cells, row.minimumHeight).bottom;
    });

    const signatureWidth = cm(5);
    const signatureX = left + half + ((half - signatureWidth) / 2);
    let signatureBuffer = null;
    let signatureHeight = cm(1.5);
    if (bon.signature) {
      try {
        signatureBuffer = Buffer.from(String(bon.signature).split(',')[1], 'base64');
        const imageWidth = signatureBuffer.readUInt32BE(16);
        const imageHeight = signatureBuffer.readUInt32BE(20);
        if (imageWidth > 0 && imageHeight > 0) {
          const imageRequiredHeight = ((signatureWidth - 12) * imageHeight) / imageWidth;
          signatureHeight = Math.min(cm(4), Math.max(cm(1.5), Math.ceil(imageRequiredHeight + 24)));
        }
      } catch { signatureBuffer = null; }
    }
    const signatureNameCells = [
      { value: `Nom du technicien: ${bon.non_du_technicien || ''}`, options: { size: 9, padding: 3 } },
      { value: `Nom du signataire: ${bon.nom_du_signataire_ || ''}`, options: { size: 9, padding: 3 } },
    ];
    const signatureNameHeight = adaptiveRowHeight([half, half], signatureNameCells, 19);
    const legalText = 'Je déclare avoir pris connaissance et rester en possession d’un exemplaire des conditions générales de ventes au verso du présent document et les accepte dans leur intégralité.\nLa clause de réserve de propriété des marchandises vendues n’interviendra qu’après parfait paiement du prix convenu (Loi N° 80-335 du 12 mai 1980).';
    const legalHeight = measureCellHeight(width, legalText, { size: 6, padding: 4 }, 26);
    const pageBottom = doc.page.height - 54;
    let signatureY = Math.max(pt(7.75), expenseBottom + 19);
    let signatureBoxY = signatureY + signatureNameHeight + 6;
    let legalY = Math.max(pt(10.559), signatureBoxY + signatureHeight + 18);
    if (legalY + legalHeight > pageBottom) {
      doc.addPage({ size: 'A4', margin: 0 });
      drawHeader();
      signatureY = pt(2.331);
      signatureBoxY = signatureY + signatureNameHeight + 6;
      legalY = signatureBoxY + signatureHeight + 24;
    }
    drawAdaptiveRow(left, signatureY, [half, half], signatureNameCells, 19);
    drawCell(signatureX, signatureBoxY, signatureWidth, signatureHeight, 'Bon pour accord', { align: 'center', size: 9, padding: 4 });
    if (signatureBuffer) {
      try {
        doc.image(signatureBuffer, signatureX + 6, signatureBoxY + 18, {
          fit: [signatureWidth - 12, signatureHeight - 24], align: 'center', valign: 'center',
        });
      } catch { /* La présence du libellé conserve la zone si l'image est illisible. */ }
    }
    drawCell(left, legalY, width, legalHeight, legalText, { size: 6, padding: 4 });

    doc.end();
  });
}

function normalizeBonPayload(body) {
  let parsedItems = [];
  try { parsedItems = Array.isArray(body.items) ? body.items : JSON.parse(body.items || '[]'); } catch { parsedItems = []; }
  if (!Array.isArray(parsedItems)) parsedItems = [];
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
    dolibarr_thirdparty_id: Number(body.dolibarr_thirdparty_id) || null,
    client_request_id: clean(body.client_request_id, 100) || null,
    items,
  };
}

function normalizeGenericPayload(body) {
  const definition = getBonType(body.bon_type, body.bon_variant);
  if (!definition) throw httpError(400, 'Le type ou la variante de document est invalide.');
  const base = normalizeBonPayload(body);
  const extra = sanitizeExtraPayload(body.extra_json, body.signature_technicien);
  const fields = extra.fields || {};
  const fallbackWork = {
    visite_massicot: `Visite trimestrielle massicot — ${(extra.checklist || []).filter((row) => row.state && row.state !== 'Non applicable').length} point(s) contrôlé(s).${fields.conformite ? ` Conclusion : ${fields.conformite}.` : ''}`,
    mise_en_service: clean(fields.observations || 'Mise en service et formation réalisées.', 10000),
    fiche_machine: clean(fields.action_realisee || fields.observation || 'Fiche machine atelier.', 10000),
  }[definition.family || definition.id];

  return {
    ...base,
    bon_type: definition.id,
    bon_variant: definition.variant.id,
    definition,
    bon_de: base.bon_de || definition.shortLabel,
    travail_effectue: base.travail_effectue || fallbackWork || definition.label,
    signature_technicien: extra.signature_technicien,
    extra,
  };
}

function sanitizeExtraPayload(value, technicianSignature) {
  const source = String(value || '{}');
  if (source.length > 9_000_000) throw httpError(413, 'Les pièces jointes sont trop volumineuses.');
  let parsed;
  try { parsed = JSON.parse(source); } catch { throw httpError(400, 'Les données complémentaires du bon sont illisibles.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  const fields = {};
  for (const [key, fieldValue] of Object.entries(parsed.fields || {}).slice(0, 250)) {
    fields[clean(key, 80)] = clean(fieldValue, 10000);
  }
  const checklist = (Array.isArray(parsed.checklist) ? parsed.checklist : []).slice(0, 80).map((row) => ({
    group: clean(row.group, 4), groupLabel: clean(row.groupLabel, 120), code: clean(row.code, 12),
    label: clean(row.label, 500), state: clean(row.state, 40), comment: clean(row.comment, 2000),
  }));
  const days = (Array.isArray(parsed.days) ? parsed.days : []).slice(0, 5).map((day) => ({
    date: clean(day.date, 32), on_site: clean(day.on_site, 40), trips: clean(day.trips, 40),
    outbound: clean(day.outbound, 40), return: clean(day.return, 40), km: clean(day.km, 40),
    tolls: clean(day.tolls, 40), meals: clean(day.meals, 40), hotel: clean(day.hotel, 40),
    parking: clean(day.parking, 40), report: clean(day.report, 10000),
  }));
  const photos = sanitizePhotos(parsed.photos);
  const privatePhotos = sanitizePhotos(parsed.privatePhotos);
  return { fields, checklist, days, photos, privatePhotos, signature_technicien: validSignature(technicianSignature || parsed.signature_technicien) };
}

function sanitizePhotos(value) {
  return (Array.isArray(value) ? value : []).slice(0, 6).map((photo, index) => ({
    name: clean(photo.name || `Photo ${index + 1}`, 120),
    data: /^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+$/i.test(String(photo.data || '')) && String(photo.data).length < 2_000_000 ? String(photo.data) : '',
  })).filter((photo) => photo.data);
}

function validateGenericPayload(payload) {
  const required = [['date_et_heure1', 'La date'], ['client', 'Le client'], ['non_du_technicien', 'Le technicien']];
  const family = payload.definition.family || payload.definition.id;
  const needsSignature = family !== 'fiche_machine' && payload.definition.fields?.some((field) => /fa-gavel/.test(field.icon || ''));
  if (needsSignature) required.push(['nom_du_signataire_', 'Le signataire']);
  if (['intervention', 'visite_massicot', 'livraison'].includes(family)) required.push(['type_materiel_', 'Le matériel ou la machine']);
  for (const [key, label] of required) if (!payload[key]) throw httpError(400, `${label} est obligatoire.`);
  if (family === 'visite_massicot' && payload.extra.checklist.length && payload.extra.checklist.length !== 42) {
    throw httpError(400, 'La checklist massicot doit contenir les 42 points de A1 à D38.');
  }
  if (needsSignature && !payload.signature) throw httpError(400, 'La signature du client est obligatoire.');
  if (family === 'intervention' && payload.definition.fields?.some((field) => field.id === 'bon_pour_accord') && !payload.bon_pour_accord) throw httpError(400, "L'accord du client est obligatoire.");
  if (payload.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.mail)) throw httpError(400, "L'adresse e-mail n'est pas valide.");
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

function buildPublicRef(id, dateValue, bonType = 'intervention') {
  const date = new Date(dateValue || Date.now());
  const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
  const prefix = BON_TYPES[bonType]?.prefix || 'BI';
  return `${prefix}-${year}-${String(id).padStart(5, '0')}`;
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

async function respondWithExistingRequest(req, res, clientRequestId) {
  if (!clientRequestId) return false;
  const existing = await dbGet('SELECT id, public_ref, sync_state FROM bons WHERE client_request_id = ?', [clientRequestId]);
  if (!existing) return false;
  if (wantsJson(req)) {
    res.status(200).json({
      ok: true,
      id: existing.id,
      publicRef: existing.public_ref,
      duplicate: true,
      sync: existing.sync_state === 'synced' ? { ok: true, alreadySynced: true } : null,
    });
  } else {
    res.redirect(`/historique.html?created=${existing.id}`);
  }
  return true;
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

module.exports = { app, db, initializeDatabase, normalizeBonPayload, normalizeGenericPayload, buildPublicRef };
