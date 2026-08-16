const fs = require('fs');
const PDFDocument = require('pdfkit');
const { getBonType } = require('./bon-types');

const COLORS = {
  ink: '#173b57', muted: '#667d8d', line: '#cfdbe2', pale: '#edf3f6', white: '#ffffff', accent: '#ec6a3c',
};

function generateGenericPdf(bon, outputPath) {
  const definition = getBonType(bon.bon_type, bon.bon_variant) || getBonType('intervention', 'gcrs');
  const extra = typeof bon.extra_json === 'string' ? parseJson(bon.extra_json, {}) : (bon.extra || {});
  const fields = extra.fields || {};
  const variantColor = definition.variant.color || COLORS.ink;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 0, bufferPages: true,
      info: { Title: `${definition.label} ${bon.public_ref}`, Author: 'GCRS Interventions' },
    });
    const output = fs.createWriteStream(outputPath);
    output.on('finish', resolve);
    output.on('error', reject);
    doc.on('error', reject);
    doc.pipe(output);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 42;
    const contentWidth = pageWidth - (margin * 2);
    const bottom = pageHeight - 46;
    let y = 0;

    const clean = (value) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').trim();
    const has = (value) => clean(value) !== '';

    function drawHeader() {
      doc.save();
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(15).text('GCRS INTERVENTIONS', margin, 29, { width: 225 });
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7.5)
        .text('Gestion des interventions, contrôles et équipements', margin, 48, { width: 260 });
      doc.roundedRect(pageWidth - margin - 112, 27, 112, 27, 6).fill(variantColor);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(10)
        .text(definition.variant.label, pageWidth - margin - 106, 35, { width: 100, align: 'center' });
      doc.moveTo(margin, 66).lineTo(pageWidth - margin, 66).lineWidth(1.5).strokeColor(variantColor).stroke();
      doc.restore();
      y = 82;
    }

    function addPage() {
      doc.addPage({ size: 'A4', margin: 0 });
      drawHeader();
    }

    function ensure(height, repeat) {
      if (y + height <= bottom) return;
      addPage();
      if (repeat) repeat();
    }

    function textHeight(value, width, size = 8.5, bold = false, padding = 7) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      return Math.ceil(doc.heightOfString(clean(value), { width: Math.max(1, width - (padding * 2)), lineGap: 1 }) + (padding * 2));
    }

    function section(title, subtitle = '') {
      ensure(subtitle ? 45 : 31);
      doc.roundedRect(margin, y, contentWidth, subtitle ? 39 : 27, 6).fill(COLORS.pale);
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10).text(title, margin + 10, y + 8, { width: contentWidth - 20 });
      if (subtitle) doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(subtitle, margin + 10, y + 22, { width: contentWidth - 20 });
      y += subtitle ? 47 : 35;
    }

    function titleBlock() {
      const date = formatDate(bon.date_et_heure1);
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(20).text(definition.label, margin, y, { width: contentWidth - 150 });
      doc.fillColor(variantColor).font('Helvetica-Bold').fontSize(13).text(bon.public_ref || '', pageWidth - margin - 145, y + 3, { width: 145, align: 'right' });
      y += 30;
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(`${date}  •  ${definition.variant.label}`, margin, y, { width: contentWidth });
      y += 24;
    }

    function drawCell(x, top, width, height, label, value, options = {}) {
      doc.save().lineWidth(.45).strokeColor(COLORS.line).roundedRect(x, top, width, height, 4).stroke().restore();
      doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(6.8).text(String(label || '').toUpperCase(), x + 7, top + 6, { width: width - 14 });
      doc.fillColor(COLORS.ink).font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 8.7)
        .text(clean(value) || '—', x + 7, top + 18, { width: width - 14, height: Math.max(1, height - 23), lineGap: 1, ellipsis: true });
    }

    function grid(rows) {
      const gap = 7;
      const columnWidth = (contentWidth - gap) / 2;
      for (const row of rows) {
        const cells = row.filter(Boolean);
        const full = cells.length === 1 || cells[0].full;
        const widths = full ? [contentWidth] : [columnWidth, columnWidth];
        const height = Math.max(43, ...cells.map((cell, index) => textHeight(cell.value, widths[index], 8.7, false, 7) + 14));
        ensure(height + 7);
        cells.forEach((cell, index) => drawCell(margin + (index * (columnWidth + gap)), y, widths[index], height, cell.label, cell.value));
        y += height + 7;
      }
    }

    function paragraph(label, value, minimum = 48) {
      if (!has(value)) return;
      const height = Math.max(minimum, textHeight(value, contentWidth, 9, false, 9) + 16);
      ensure(height + 7);
      drawCell(margin, y, contentWidth, height, label, value, { size: 9 });
      y += height + 7;
    }

    function drawItems(items) {
      const rows = Array.isArray(items) && items.length ? items : [];
      if (!rows.length) return;
      section('Pièces et fournitures', 'Une commande Dolibarr sera préparée à partir de ces lignes.');
      const widths = [72, 224, 65, 45, 81];
      const headers = ['Code', 'Désignation', 'Prix HT', 'Qté', 'Total HT'];
      const header = () => {
        doc.rect(margin, y, contentWidth, 22).fill(variantColor);
        let x = margin;
        headers.forEach((label, index) => {
          doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(7).text(label, x + 4, y + 7, { width: widths[index] - 8, align: index > 1 ? 'right' : 'left' });
          x += widths[index];
        });
        y += 22;
      };
      ensure(44); header();
      for (const item of rows) {
        const values = [item.code, item.designation, money(item.unit_price), number(item.quantity), money(item.line_total)];
        const height = Math.max(24, textHeight(item.designation, widths[1], 8, false, 5));
        ensure(height + 2, header);
        let x = margin;
        values.forEach((value, index) => {
          doc.rect(x, y, widths[index], height).lineWidth(.4).strokeColor(COLORS.line).stroke();
          doc.fillColor(COLORS.ink).font('Helvetica').fontSize(8).text(clean(value) || '—', x + 4, y + 7, { width: widths[index] - 8, align: index > 1 ? 'right' : 'left' });
          x += widths[index];
        });
        y += height;
      }
      y += 8;
    }

    function checklist(rows) {
      if (!Array.isArray(rows) || !rows.length) return;
      section('Liste des points à examiner', 'États : Bon, Mauvais, Inexistant ou Non applicable. Les observations restent liées à leur point de contrôle.');
      const widths = [42, 257, 78, 110];
      const headers = ['Point', 'Contrôle', 'État', 'Observation'];
      const header = () => {
        doc.rect(margin, y, contentWidth, 23).fill(variantColor);
        let x = margin;
        headers.forEach((label, index) => {
          doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(7).text(label, x + 4, y + 7, { width: widths[index] - 8 });
          x += widths[index];
        });
        y += 23;
      };
      ensure(46); header();
      let previousGroup = '';
      for (const row of rows) {
        if (row.group !== previousGroup) {
          previousGroup = row.group;
          const groupText = row.groupLabel || `Section ${row.group}`;
          ensure(21, header);
          doc.rect(margin, y, contentWidth, 19).fill(COLORS.pale);
          doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(7.5).text(`${row.group} — ${groupText}`, margin + 6, y + 6, { width: contentWidth - 12 });
          y += 19;
        }
        const height = Math.max(25, textHeight(row.label, widths[1], 7.6, false, 5), textHeight(row.comment, widths[3], 7.4, false, 5));
        ensure(height + 2, header);
        const values = [row.code, row.label, row.state || '—', row.comment || ''];
        let x = margin;
        values.forEach((value, index) => {
          doc.rect(x, y, widths[index], height).lineWidth(.35).strokeColor(COLORS.line).stroke();
          doc.fillColor(index === 2 && /mauvais|inexistant/i.test(value) ? '#a13e43' : COLORS.ink)
            .font(index === 0 || index === 2 ? 'Helvetica-Bold' : 'Helvetica').fontSize(index === 3 ? 7.2 : 7.6)
            .text(clean(value) || '—', x + 4, y + 6, { width: widths[index] - 8, height: height - 10 });
          x += widths[index];
        });
        y += height;
      }
      y += 8;
    }

    function dailyReports(days) {
      const activeDays = (Array.isArray(days) ? days : []).filter((day) => has(day.date) || has(day.report));
      if (!activeDays.length) return;
      section('Rapports et frais par jour');
      activeDays.forEach((day, index) => {
        ensure(39);
        doc.fillColor(variantColor).font('Helvetica-Bold').fontSize(9).text(`Jour ${index + 1}${has(day.date) ? ` — ${formatDateOnly(day.date)}` : ''}`, margin, y);
        y += 17;
        grid([[{ label: 'Main-d’œuvre sur site', value: day.on_site }, { label: 'Déplacements', value: day.trips }],
          [{ label: 'Trajet aller / retour', value: [day.outbound, day.return].filter(has).join(' / ') }, { label: 'Kilomètres A/R', value: day.km }],
          [{ label: 'Péages / parking', value: [day.tolls, day.parking].filter(has).join(' / ') }, { label: 'Repas / hôtel', value: [day.meals, day.hotel].filter(has).join(' / ') }]]);
        paragraph(`Rapport du jour ${index + 1}`, day.report, 52);
      });
    }

    function photos(photosList) {
      const valid = (Array.isArray(photosList) ? photosList : []).map((photo) => ({ ...photo, buffer: dataBuffer(photo.data) })).filter((photo) => photo.buffer);
      if (!valid.length) return;
      ensure(215);
      section('Photos jointes au rapport');
      const gap = 10;
      const boxWidth = (contentWidth - gap) / 2;
      for (let index = 0; index < valid.length; index += 2) {
        ensure(180);
        valid.slice(index, index + 2).forEach((photo, offset) => {
          const x = margin + (offset * (boxWidth + gap));
          doc.roundedRect(x, y, boxWidth, 168, 5).lineWidth(.5).strokeColor(COLORS.line).stroke();
          try { doc.image(photo.buffer, x + 6, y + 6, { fit: [boxWidth - 12, 140], align: 'center', valign: 'center' }); } catch { /* image ignorée */ }
          doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(clean(photo.name) || `Photo ${index + offset + 1}`, x + 6, y + 150, { width: boxWidth - 12, align: 'center' });
        });
        y += 178;
      }
    }

    function signatureBox(x, top, label, name, data) {
      const width = cm(5);
      let height = cm(1.5);
      const buffer = dataBuffer(data);
      if (buffer) {
        try {
          const image = doc.openImage(buffer);
          height = Math.min(cm(4), Math.max(cm(1.5), ((width - 12) * image.height / image.width) + 27));
        } catch { /* hauteur minimale */ }
      }
      doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(6.8).text(label.toUpperCase(), x, top, { width });
      doc.fillColor(COLORS.ink).font('Helvetica').fontSize(8.5).text(clean(name) || '—', x, top + 11, { width });
      const boxTop = top + 25;
      doc.roundedRect(x, boxTop, width, height, 5).lineWidth(.6).strokeColor(COLORS.line).stroke();
      if (buffer) {
        try { doc.image(buffer, x + 6, boxTop + 6, { fit: [width - 12, height - 12], align: 'center', valign: 'center' }); } catch { /* signature illisible */ }
      } else {
        doc.fillColor('#a8b6bf').font('Helvetica-Oblique').fontSize(7.5).text('Non renseignée', x + 6, boxTop + (height / 2) - 4, { width: width - 12, align: 'center' });
      }
      return 25 + height;
    }

    function signatures() {
      const width = cm(5);
      const leftX = margin + 25;
      const rightX = pageWidth - margin - width - 25;
      const techHeight = signatureHeight(extra.signature_technicien);
      const clientHeight = signatureHeight(bon.signature || extra.signature_client);
      ensure(70 + Math.max(techHeight, clientHeight));
      section('Signatures');
      const h1 = signatureBox(leftX, y, definition.id === 'mise_en_service' ? 'Formateur' : 'Technicien', bon.non_du_technicien, extra.signature_technicien);
      const h2 = signatureBox(rightX, y, 'Signataire client', bon.nom_du_signataire_, bon.signature || extra.signature_client);
      y += Math.max(h1, h2) + 10;
    }

    function signatureHeight(data) {
      const width = cm(5);
      const buffer = dataBuffer(data);
      if (!buffer) return cm(1.5);
      try {
        const image = doc.openImage(buffer);
        return Math.min(cm(4), Math.max(cm(1.5), ((width - 12) * image.height / image.width) + 27));
      } catch { return cm(1.5); }
    }

    drawHeader();
    titleBlock();
    section(definition.id === 'intervention' ? 'Client et intervention' : 'Client et document');
    grid([
      [{ label: 'Client', value: bon.client }, { label: 'Référence client', value: bon.ref_cde_client }],
      [{ label: 'Téléphone', value: bon.tel_ }, { label: 'E-mail', value: bon.mail }],
      [{ label: 'Adresse', value: bon.adresse, full: true }],
      [{ label: 'Matériel / machine', value: bon.type_materiel_ }, { label: 'N° série / matricule', value: bon.n_de_matricule_ }],
    ]);

    if (definition.id === 'intervention') {
      section("Rapport d’intervention");
      grid([[{ label: 'Bon de', value: bon.bon_de }, { label: 'Compteur', value: fields.compteur }],
        [{ label: 'Panne signalée', value: fields.panne_signalee, full: true }]]);
      paragraph('Travail effectué', bon.travail_effectue, 70);
      dailyReports(extra.days);
      grid([[{ label: 'Type d’intervention', value: fields.intervention_type }, { label: 'Nombre de passages', value: fields.nombre_passage }],
        [{ label: 'Suivi / contrat / garantie', value: joinFlags(fields, ['intervention_a_suivre', 'sous_contrat', 'sous_garantie', 'validation_fonctionnement']), full: true }]]);
      drawItems(bon.items);
      section('Temps, frais et déplacement');
      grid([[{ label: "Heure d’arrivée", value: bon.heures_d_arrivee }, { label: 'Heure de départ', value: bon.heure_depart }],
        [{ label: 'Temps passé', value: bon.temps_passe }, { label: 'Déplacement', value: bon.deplacement }],
        [{ label: 'Kilomètres', value: number(bon.km) }, { label: 'Repas', value: number(bon.repas) }],
        [{ label: 'Hôtel', value: number(bon.hotel) }, { label: 'Autoroute / péages', value: money(bon.autoroute) }]]);
      paragraph('Divers / fournitures', fields.divers || fields.fourniture, 44);
    } else if (definition.id === 'visite_massicot') {
      section('Identification du contrôle');
      grid([[{ label: 'Trimestre', value: fields.trimestre }, { label: 'N° identification', value: fields.numero_identification }],
        [{ label: 'Marque', value: fields.marque }, { label: 'Type', value: fields.type_machine }]]);
      checklist(extra.checklist);
      section('Changement de lame');
      grid([[{ label: 'Changement effectué', value: fields.changement_lame }, { label: 'Taille de lame', value: fields.taille_lame }],
        [{ label: 'État de la lame enlevée', value: fields.etat_lame }, { label: 'Usure de la lame', value: fields.usure_lame }],
        [{ label: 'Observation', value: fields.commentaire_lame, full: true }]]);
      section('Conclusion de la visite');
      grid([[{ label: 'Conformité de l’équipement', value: fields.conformite }, { label: 'Technicien', value: bon.non_du_technicien }]]);
      paragraph('Non-conformités et actions recommandées', fields.non_conformite, 60);
      paragraph('Fournitures', fields.fournitures, 44);
      paragraph('Divers', fields.divers, 44);
    } else if (definition.id === 'mise_en_service') {
      section('Mise en service et formation');
      grid([[{ label: 'Contact', value: fields.contact }, { label: 'E-mail', value: bon.mail }],
        [{ label: 'Supports de formation', value: fields.supports_formation }, { label: 'Liste / formation', value: fields.liste_formation }]]);
      paragraph('Numéros de série', fields.numeros_serie || bon.n_de_matricule_, 50);
      paragraph('Observations', fields.observations || bon.travail_effectue, 70);
      paragraph('Présences à la formation', fields.presences_formation, 55);
    } else if (definition.id === 'fiche_machine') {
      section('Réception et diagnostic atelier');
      grid([[{ label: 'Provenance', value: fields.provenance }, { label: 'But', value: fields.but }],
        [{ label: 'Compteur', value: fields.compteur }, { label: 'Issue', value: fields.issue }],
        [{ label: 'Devis', value: fields.devis }, { label: 'Mise au rebut', value: fields.mise_au_rebut }]]);
      paragraph('Observations', fields.observation || bon.travail_effectue, 70);
      paragraph('Actions réalisées', fields.action_realisee, 70);
    }

    photos(extra.photos);
    signatures();

    if (definition.id === 'intervention') {
      ensure(45);
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(6.3)
        .text("Le signataire reconnaît avoir pris connaissance du présent bon et atteste la réalité des travaux, temps et fournitures qui y figurent. La facture correspondante reste créée en brouillon dans Dolibarr jusqu’à validation administrative.", margin, y, { width: contentWidth, align: 'justify' });
    }

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      doc.moveTo(margin, pageHeight - 34).lineTo(pageWidth - margin, pageHeight - 34).lineWidth(.4).strokeColor(COLORS.line).stroke();
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(6.7).text(`${bon.public_ref}  •  ${definition.label}`, margin, pageHeight - 27, { width: contentWidth - 70 });
      doc.text(`Page ${index - range.start + 1}/${range.count}`, pageWidth - margin - 70, pageHeight - 27, { width: 70, align: 'right' });
    }
    doc.end();
  });
}

function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function dataBuffer(value) {
  const match = String(value || '').match(/^data:image\/(?:png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match || match[1].length > 4_000_000) return null;
  try { return Buffer.from(match[1], 'base64'); } catch { return null; }
}
function joinFlags(fields, keys) {
  const labels = {
    intervention_a_suivre: 'Intervention à suivre', sous_contrat: 'Sous contrat',
    sous_garantie: 'Sous garantie', validation_fonctionnement: 'Fonctionnement validé',
  };
  const values = keys.filter((key) => ['1', 'true', 'oui', 'yes'].includes(String(fields[key] || '').toLowerCase())).map((key) => labels[key]);
  return values.join(' • ') || '—';
}
function cm(value) { return (value * 72) / 2.54; }
function number(value) { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(value) || 0); }
function money(value) { return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)} €`; }
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(date);
}
function formatDateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(date);
}

module.exports = { generateGenericPdf, dataBuffer };
