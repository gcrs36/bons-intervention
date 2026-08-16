const fs = require('fs');

class DolibarrError extends Error {
  constructor(message, status = 502, details = null) {
    super(message);
    this.name = 'DolibarrError';
    this.status = status;
    this.details = details;
  }
}

class DolibarrClient {
  constructor({ baseUrl, apiKey, entity, vatRate = 20 }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.apiBase = `${this.baseUrl}/api/index.php`;
    this.apiKey = apiKey;
    this.entity = entity;
    this.vatRate = vatRate;
  }

  isConfigured() { return Boolean(this.baseUrl && this.apiKey); }

  async request(method, resource, body) {
    if (!this.isConfigured()) throw new DolibarrError('Connexion Dolibarr non configurée.', 503);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const headers = { Accept: 'application/json', DOLAPIKEY: this.apiKey };
      if (this.entity) headers.DOLAPIENTITY = String(this.entity);
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${this.apiBase}/${String(resource).replace(/^\//, '')}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
      });
      const text = await response.text();
      const contentType = response.headers.get('content-type') || '';
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (response.ok && !contentType.includes('json') && /module\s+Api.*activ/i.test(text)) {
        throw new DolibarrError('Le module API REST doit être activé dans Dolibarr.', 503, text);
      }
      if (!response.ok) {
        const apiMessage = extractDolibarrErrorMessage(data);
        throw new DolibarrError(`Dolibarr ${response.status} : ${apiMessage || response.statusText}`, response.status, data);
      }
      return data;
    } catch (error) {
      if (error instanceof DolibarrError) throw error;
      if (error.name === 'AbortError') throw new DolibarrError('Dolibarr ne répond pas dans le délai imparti.', 504);
      throw new DolibarrError(`Connexion à Dolibarr impossible : ${error.message}`, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchThirdparties(query) {
    const cleanQuery = String(query).replace(/[^\p{L}\p{N} .&'_-]/gu, '').replace(/'/g, "\\'").slice(0, 80);
    const params = new URLSearchParams({
      sortfield: 't.nom', sortorder: 'ASC', limit: '20', mode: '1',
      properties: 'id,name,email,phone,address,zip,town',
      sqlfilters: `(t.nom:like:'%${cleanQuery}%')`,
    });
    let result;
    try {
      result = await this.request('GET', `thirdparties?${params}`);
    } catch (error) {
      // Dolibarr répond 404 quand une recherche de tiers ne trouve aucun client.
      // Pour l'application, il s'agit d'une liste vide et non d'un échec API.
      if (error instanceof DolibarrError && error.status === 404) return [];
      throw error;
    }
    return (Array.isArray(result) ? result : result?.data || []).map((thirdparty) => ({
      id: Number(thirdparty.id), name: thirdparty.name, email: thirdparty.email || '', phone: thirdparty.phone || '',
      address: thirdparty.address || '', zip: thirdparty.zip || '', town: thirdparty.town || '',
    }));
  }
}

async function buildDolibarrFlow({ client, bon, pdfPath, onProgress = async () => {} }) {
  const ids = {
    thirdparty: Number(bon.dolibarr_thirdparty_id) || null,
    intervention: Number(bon.dolibarr_intervention_id) || null,
    order: Number(bon.dolibarr_order_id) || null,
    invoice: Number(bon.dolibarr_invoice_id) || null,
  };
  const timestamp = toTimestamp(bon.date_et_heure1);
  const duration = durationSeconds(bon);

  if (!ids.thirdparty) {
    const matches = await client.searchThirdparties(bon.client);
    const exact = matches.find((item) => normalize(item.name) === normalize(bon.client));
    ids.thirdparty = exact?.id || Number(await client.request('POST', 'thirdparties', {
      name: bon.client, client: 1, code_client: '-1', email: bon.mail || '', phone: bon.tel_ || '', address: bon.adresse || '',
      caller: 'gcrsinterventions',
    }));
    await onProgress('thirdparty', { id: ids.thirdparty }, exact ? 'Client Dolibarr retrouvé.' : 'Client Dolibarr créé.');
  }

  if (!ids.intervention) {
    ids.intervention = Number(await client.request('POST', 'interventions', {
      socid: ids.thirdparty, fk_project: 0, description: interventionDescription(bon),
      note_public: `Bon signé ${bon.public_ref}`, note_private: `Créé par GCRS Interventions — ${bon.public_ref}`,
      caller: 'gcrsinterventions',
    }));
    await onProgress('intervention', { id: ids.intervention }, 'Fiche d’intervention Dolibarr créée.');
    await client.request('POST', `interventions/${ids.intervention}/lines`, {
      description: bon.travail_effectue, date: timestamp, duration, caller: 'gcrsinterventions',
    });
  }

  if (pdfPath && !Number(bon.dolibarr_pdf_uploaded)) {
    const intervention = await client.request('GET', `interventions/${ids.intervention}`);
    await client.request('POST', 'documents/upload', {
      filename: `${bon.public_ref}.pdf`, modulepart: 'fichinter', ref: intervention.ref || String(ids.intervention),
      filecontent: fs.readFileSync(pdfPath).toString('base64'), fileencoding: 'base64', overwriteifexists: 1,
    });
    await onProgress('pdf', { id: 1 }, 'PDF signé joint à la fiche d’intervention.');
  }

  const items = Array.isArray(bon.items) ? bon.items.filter((item) => item.designation || item.code) : [];
  if (items.length && !ids.order) {
    ids.order = Number(await client.request('POST', 'orders', {
      socid: ids.thirdparty, date: timestamp, type: 0, ref_client: bon.ref_cde_client || bon.public_ref,
      note_public: `Pièces utilisées lors de l’intervention ${bon.public_ref}`,
      note_private: `Fiche d'intervention Dolibarr #${ids.intervention}`, caller: 'gcrsinterventions',
    }));
    for (const [index, item] of items.entries()) {
      await client.request('POST', `orders/${ids.order}/lines`, dolibarrLine(item, client.vatRate, index));
    }
    await onProgress('order', { id: ids.order }, 'Commande brouillon créée avec les pièces utilisées.');
  }

  if (!ids.invoice) {
    if (ids.order) {
      const invoice = await client.request('POST', `invoices/createfromorder/${ids.order}`, {});
      ids.invoice = Number(invoice?.id || invoice);
    } else {
      ids.invoice = Number(await client.request('POST', 'invoices', {
        socid: ids.thirdparty, date: timestamp, type: 0, ref_client: bon.ref_cde_client || bon.public_ref,
        note_public: `Intervention ${bon.public_ref} — montant à compléter avant validation.`,
        note_private: `Fiche d'intervention Dolibarr #${ids.intervention}`, caller: 'gcrsinterventions',
      }));
      await client.request('POST', `invoices/${ids.invoice}/lines`, dolibarrLine({
        designation: `Intervention ${bon.public_ref} — ${bon.travail_effectue}`, unit_price: 0, quantity: 1, vat_rate: client.vatRate,
      }, client.vatRate, 0, 1));
    }
    await onProgress('invoice', { id: ids.invoice }, 'Facture brouillon créée.');
  }

  return ids;
}

function dolibarrLine(item, defaultVat, index, productType = 0) {
  const code = item.code ? `[${item.code}] ` : '';
  return {
    desc: `${code}${item.designation || 'Pièce'}`, label: item.designation || item.code || 'Pièce',
    subprice: Number(item.unit_price) || 0, qty: Number(item.quantity) || 1,
    tva_tx: Number(item.vat_rate ?? defaultVat) || 0, localtax1_tx: 0, localtax2_tx: 0,
    fk_product: Number(item.product_id) || 0, remise_percent: 0, info_bits: 0, fk_remise_except: 0,
    price_base_type: 'HT', product_type: productType, rang: index + 1, special_code: 0,
    fk_parent_line: 0, fk_fournprice: 0, pa_ht: 0, array_options: {},
  };
}

function interventionDescription(bon) {
  return [
    `${bon.public_ref} — ${bon.bon_de}`,
    bon.ref_cde_client ? `Référence client : ${bon.ref_cde_client}` : '',
    bon.type_materiel_ ? `Matériel : ${bon.type_materiel_}` : '',
    bon.n_de_matricule_ ? `Matricule : ${bon.n_de_matricule_}` : '',
    `Travail effectué : ${bon.travail_effectue}`,
    bon.non_du_technicien ? `Technicien : ${bon.non_du_technicien}` : '',
    bon.nom_du_signataire_ ? `Signé par : ${bon.nom_du_signataire_}` : '',
  ].filter(Boolean).join('\n');
}

function durationSeconds(bon) {
  const explicit = String(bon.temps_passe || '').match(/(?:(\d+)\s*h)?\s*(\d+)?/i);
  if (explicit && (explicit[1] || explicit[2])) return Math.max(((Number(explicit[1]) || 0) * 3600) + ((Number(explicit[2]) || 0) * 60), 60);
  const [ah, am] = String(bon.heures_d_arrivee || '').split(':').map(Number);
  const [dh, dm] = String(bon.heure_depart || '').split(':').map(Number);
  if ([ah, am, dh, dm].every(Number.isFinite)) {
    let minutes = (dh * 60 + dm) - (ah * 60 + am);
    if (minutes < 0) minutes += 24 * 60;
    return Math.max(minutes * 60, 60);
  }
  return 3600;
}

function toTimestamp(value) { const time = new Date(value).getTime(); return Number.isNaN(time) ? Math.floor(Date.now() / 1000) : Math.floor(time / 1000); }
function normalize(value) { return String(value || '').trim().toLocaleLowerCase('fr-FR'); }

function extractDolibarrErrorMessage(data) {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return '';

  const error = data.error;
  const primary = typeof error === 'string'
    ? error
    : (typeof error?.message === 'string' ? error.message : (typeof data.message === 'string' ? data.message : ''));
  const details = [];

  const collect = (value, key = '') => {
    if (typeof value === 'string' && value.trim() && key !== 'message') details.push(value.trim());
    else if (Array.isArray(value)) value.forEach((item) => collect(item));
    else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([childKey, childValue]) => {
        if (!['code', 'message'].includes(childKey)) collect(childValue, childKey);
      });
    }
  };
  collect(error);

  return [primary, ...details]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(' — ');
}

module.exports = { DolibarrClient, DolibarrError, buildDolibarrFlow, durationSeconds, dolibarrLine, extractDolibarrErrorMessage };
