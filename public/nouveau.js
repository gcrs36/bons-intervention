const form = document.querySelector('#universalForm');
const companyCards = document.querySelector('#companyCards');
const typeCards = document.querySelector('#typeCards');
const variantSelect = document.querySelector('#variantSelect');
const formHost = document.querySelector('#familyFields');
const itemsJson = document.querySelector('#itemsJson');
const extraJson = document.querySelector('#extraJson');
const toast = document.querySelector('#toast');
const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

let schemas;
let selectedCompany = 'gcrs';
let selectedType = '';
let dolibarrConfigured = false;
let searchTimer;
let activeClientInput = null;
const signatureState = {};
const companyOrder = ['gcrs', 'dimensions', 'esi', 'abeg', 'arboreal', 'clementz'];
const companyDescriptions = {
  gcrs: '15 formulaires terrain, atelier, commerce et frais',
  dimensions: 'Le bon Dimensions original',
  esi: 'Visite, intervention et livraison matériel',
  abeg: 'Intervention technique et visite massicot',
  arboreal: 'Intervention et visite massicot ARBOREAL',
  clementz: 'Contrat d’intervention Clementz',
};
const canonical = {
  date: document.querySelector('#canonicalDate'), client: document.querySelector('#canonicalClient'),
  reference: document.querySelector('#canonicalReference'), phone: document.querySelector('#canonicalPhone'),
  mail: document.querySelector('#canonicalMail'), address: document.querySelector('#canonicalAddress'),
  machine: document.querySelector('#canonicalMachine'), serial: document.querySelector('#canonicalSerial'),
  bonDe: document.querySelector('#canonicalBonDe'), work: document.querySelector('#canonicalWork'),
  duration: document.querySelector('#canonicalDuration'), technician: document.querySelector('#canonicalTechnician'),
  signatory: document.querySelector('#canonicalSignatory'), arrival: document.querySelector('#canonicalArrival'),
  departure: document.querySelector('#canonicalDeparture'), travel: document.querySelector('#canonicalTravel'),
  agreement: document.querySelector('#canonicalAgreement'),
};

function localDateTimeValue(date = new Date()) {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  rounded.setMinutes(Math.floor(rounded.getMinutes() / 5) * 5);
  const offset = rounded.getTimezoneOffset() * 60000;
  return new Date(rounded.getTime() - offset).toISOString().slice(0, 16);
}

document.querySelector('#clientRequestId').value = window.OfflineStore?.createId() || window.crypto?.randomUUID?.() || `request-${Date.now()}`;

async function initialize() {
  try {
    const [typesResponse, configResponse] = await Promise.all([fetch('/api/bon-types'), fetch('/api/config')]);
    if (!typesResponse.ok) throw new Error('Les modèles de bons sont indisponibles.');
    schemas = await typesResponse.json();
    configureDolibarr(configResponse.ok ? await configResponse.json() : {});
    const parameters = new URLSearchParams(location.search);
    renderCompanyCards();
    selectCompany(parameters.get('societe') || parameters.get('variante') || 'gcrs', parameters.get('type'));
  } catch (error) {
    showToast(error.message, true);
    document.querySelector('#submitButton').disabled = true;
  }
}

function renderCompanyCards() {
  companyCards.innerHTML = companyOrder.filter((companyId) => schemas.variants[companyId]).map((companyId) => {
    const company = schemas.variants[companyId];
    const count = Object.values(schemas.types).filter((type) => type.variants.includes(companyId)).length;
    const mark = company.logo
      ? `<span class="company-card-logo"><img src="${escapeAttr(company.logo)}" alt="Logo ${escapeAttr(company.label)}"></span>`
      : `<span class="company-card-mark">${escapeHtml(company.label.slice(0, 3))}</span>`;
    return `<button class="company-card" type="button" data-company="${escapeAttr(companyId)}" style="--company-color:${escapeAttr(company.color)}">${mark}<span><strong>${escapeHtml(company.label)}</strong><small>${escapeHtml(companyDescriptions[companyId] || `${count} formulaire(s) disponible(s)`)}</small><em>${count} bon${count > 1 ? 's' : ''}</em></span></button>`;
  }).join('');
}

function selectCompany(companyId, preferredType) {
  selectedCompany = schemas.variants[companyId] ? companyId : 'gcrs';
  [...companyCards.querySelectorAll('.company-card')].forEach((card) => card.classList.toggle('selected', card.dataset.company === selectedCompany));
  document.querySelector('#selectedCompanyLabel').textContent = schemas.variants[selectedCompany].label;
  renderTypeCards();
  const availableTypes = Object.values(schemas.types).filter((type) => type.variants.includes(selectedCompany));
  const requested = availableTypes.some((type) => type.id === preferredType) ? preferredType : availableTypes[0].id;
  selectType(requested);
}

function renderTypeCards() {
  typeCards.innerHTML = Object.values(schemas.types).filter((type) => type.variants.includes(selectedCompany)).map((type) => `
    <button class="type-card" type="button" data-type="${escapeAttr(type.id)}"><span class="type-card-icon">${typeIcon(type.family)}</span><span><strong>${escapeHtml(type.label)}</strong><small>${escapeHtml(type.description)}</small><em>Modèle Kizeo n° ${escapeHtml(type.kizeoId)}</em></span></button>`).join('');
}

function selectType(typeId) {
  const definition = schemas.types[typeId]?.variants.includes(selectedCompany)
    ? schemas.types[typeId] : Object.values(schemas.types).find((type) => type.variants.includes(selectedCompany));
  selectedType = definition.id;
  document.querySelector('#bonTypeInput').value = definition.id;
  document.querySelector('#bonVariantInput').value = selectedCompany;
  variantSelect.innerHTML = `<option value="${escapeAttr(selectedCompany)}">${escapeHtml(schemas.variants[selectedCompany].label)}</option>`;
  [...typeCards.querySelectorAll('.type-card')].forEach((card) => card.classList.toggle('selected', card.dataset.type === definition.id));
  document.querySelector('#pageTitle').textContent = `${schemas.variants[selectedCompany].label} — ${definition.label}`;
  document.querySelector('#pageLead').textContent = `Formulaire et PDF spécifiques au modèle Kizeo n° ${definition.kizeoId}.`;
  document.querySelector('#summaryType').textContent = definition.label;
  document.querySelector('#summaryVariant').textContent = schemas.variants[selectedCompany].label;
  document.querySelector('.summary-head').style.background = schemas.variants[selectedCompany].color;
  document.querySelector('#syncInput').checked = Boolean(definition.syncDefault && dolibarrConfigured);
  const url = new URL(window.location.href);
  url.searchParams.set('societe', selectedCompany); url.searchParams.set('type', definition.id); url.searchParams.delete('variante');
  window.history.replaceState({}, '', url);
  renderKizeoForm(definition, schemas.variants[selectedCompany]);
}

function renderKizeoForm(definition, variant) {
  Object.keys(signatureState).forEach((key) => delete signatureState[key]);
  const sourceFields = Array.isArray(definition.fields) ? definition.fields : [];
  let number = 0;
  let html = `<section class="form-card kizeo-form kizeo-${escapeAttr(definition.family || 'document')}" style="--company-color:${escapeAttr(variant.color)}">
    <div class="kizeo-sheet-head"><img src="${escapeAttr(variant.logo || '/logo-gcrs.png')}" alt="${escapeAttr(variant.label)}"><div><p>FORMULAIRE KIZEO N° ${escapeHtml(definition.kizeoId)}</p><h2>${escapeHtml(definition.label)}</h2><span>${escapeHtml(variant.label)} · les champs et sections suivent l’ordre du modèle d’origine.</span></div></div>
    <div class="kizeo-sheet-body">`;
  let openGrid = false;
  const closeGrid = () => { if (openGrid) { html += '</div>'; openGrid = false; } };
  const open = () => { if (!openGrid) { html += '<div class="form-grid kizeo-grid">'; openGrid = true; } };

  for (let index = 0; index < sourceFields.length; index += 1) {
    const sourceField = sourceFields[index];
    const icon = sourceField.icon || '';
    if (/fa-bookmark/.test(icon)) {
      closeGrid();
      const label = /s[eé]parateur/i.test(sourceField.label) ? 'Informations complémentaires' : sourceField.label;
      number += 1;
      html += `<div class="kizeo-section"><span>${number}</span><h3>${escapeHtml(label)}</h3></div>`;
      continue;
    }
    if (/fa-table/.test(icon)) {
      closeGrid();
      const { columns, cursor } = tableColumns(sourceFields, index);
      html += tableMarkup(sourceField, columns);
      index = cursor - 1;
      continue;
    }
    open();
    html += controlMarkup(sourceField, index);
  }
  closeGrid();
  html += `</div></section>`;
  formHost.innerHTML = html;
  bindKizeoForm(definition);
  updateSummary();
}

function tableColumns(sourceFields, startIndex) {
  // The Kizeo export only exposes the table container for commercial
  // prestations (its inner columns are not represented as normal fields).
  // Recreate the visible operational columns without swallowing the fields
  // that follow the table in the original form.
  if (/prestation/i.test(sourceFields[startIndex]?.label || '')) {
    return {
      columns: [
        { id: 'designation', label: 'Prestation' },
        { id: 'quantite', label: 'Quantité' },
        { id: 'prix_ht', label: 'Prix HT' },
        { id: 'total_ht', label: 'Total HT' },
      ],
      cursor: startIndex + 1,
    };
  }
  const columns = [];
  let cursor = startIndex + 1;
  while (cursor < sourceFields.length && !/fa-bookmark|fa-table/.test(sourceFields[cursor].icon || '')) {
    const candidate = sourceFields[cursor];
    const label = String(candidate.label || '');
    if (/fa-photo|fa-gavel|fa-file-image/.test(candidate.icon || '')) break;
    if (columns.length && /type.*intervention|validation|date|heure|signature|technicien|signataire/i.test(label)) break;
    columns.push(candidate);
    cursor += 1;
    if (/total\s*(h\.?t\.?|ttc)?/i.test(label) || columns.length >= 5) break;
  }
  return { columns: columns.length ? columns : [{ id: 'ligne', label: 'Ligne' }], cursor };
}

function controlMarkup(field, index) {
  const icon = field.icon || '';
  const fieldId = escapeAttr(field.id);
  const label = escapeHtml(field.label || 'Champ');
  const description = field.required ? '<span class="source-required" title="Champ requis dans Kizeo">K</span>' : '';
  const long = /d[eé]tail|travail|observ|comment|motif|rem[eè]de|adresse|rapport|description|condition|anomal/i.test(field.label || '') || /fa-align-left|fa-house|fa-paragraph/.test(icon);
  const primaryClient = isClientField(field) ? ' data-role="client" autocomplete="organization"' : '';
  const defaultDate = /fa-calendar/.test(icon) && /date|heure|intervention du|appel du/i.test(field.label || '') ? ` value="${localDateTimeValue()}"` : '';
  if (/fa-gavel/.test(icon)) return `<div class="field span-2 signature-field" data-signature-field="${fieldId}"><label>${label} ${description}</label><div class="signature-pad"><canvas class="signatureCanvas" data-kizeo="${fieldId}" aria-label="${label}"></canvas><div class="signature-actions"><button class="btn btn-ghost btn-small clear-signature" data-target="${fieldId}" type="button">Effacer</button></div></div><div class="hint">Zone de signature liée au PDF de ce bon.</div></div>`;
  if (/fa-photo|fa-file-image/.test(icon)) return `<div class="field span-2"><label>${label} ${description}</label><input class="photo-upload" data-kizeo-photo="${fieldId}" type="file" accept="image/*" capture="environment" multiple><div class="hint">Les photos de ce champ seront jointes au PDF client.</div></div>`;
  if (/fa-square-check/.test(icon)) return `<label class="checkbox compact-check kizeo-check"><input data-kizeo="${fieldId}" type="checkbox" value="1"><span>${label} ${description}</span></label>`;
  if (/fa-circle-check/.test(icon)) {
    if (/nom|technicien|formateur|client|machine|marque|type mat[eé]riel/i.test(field.label || '')) return `<div class="field"><label>${label} ${description}</label><input data-kizeo="${fieldId}" type="text"${primaryClient}></div>`;
    const choices = fieldChoices(field);
    return `<div class="field"><label>${label} ${description}</label><select data-kizeo="${fieldId}">${choices.map((choice) => `<option value="${escapeAttr(choice)}">${escapeHtml(choice || 'Sélectionner…')}</option>`).join('')}</select></div>`;
  }
  if (/fa-calendar/.test(icon)) return `<div class="field"><label>${label} ${description}</label><input data-kizeo="${fieldId}" type="datetime-local" step="300"${defaultDate}></div>`;
  if (long) return `<div class="field span-2"><label>${label} ${description}</label><textarea data-kizeo="${fieldId}" rows="${/d[eé]tail|travail|rapport|observ/i.test(field.label || '') ? 5 : 3}"></textarea></div>`;
  const isNumber = /calculator|square-plus/.test(icon) || /quantit[eé]|compteur|km|prix|total|co[uû]t|montant|heure|passage/i.test(field.label || '');
  const type = /mail/i.test(field.label || '') ? 'email' : (/t[eé]l/i.test(field.label || '') ? 'tel' : (isNumber ? 'number' : 'text'));
  return `<div class="field"><label>${label} ${description}</label><input data-kizeo="${fieldId}" type="${type}"${isNumber ? ' min="0" step="0.01"' : ''}${primaryClient}></div>`;
}

function tableMarkup(field, columns) {
  const safeColumns = columns.length ? columns : [{ id: 'ligne', label: 'Ligne' }];
  return `<section class="kizeo-table" data-kizeo-table="${escapeAttr(field.id)}"><div class="kizeo-table-head"><div><h3>${escapeHtml(field.label)}</h3><p>Tableau dynamique du modèle Kizeo</p></div><button class="btn btn-secondary btn-small add-kizeo-row" type="button">＋ Ajouter une ligne</button></div><div class="kizeo-table-columns" style="--kizeo-columns:${safeColumns.length + 1}">${safeColumns.map((column) => `<span>${escapeHtml(column.label)}</span>`).join('')}<span aria-hidden="true"></span></div><div class="kizeo-table-rows" data-columns="${escapeAttr(JSON.stringify(safeColumns.map(({ id, label }) => ({ id, label }))))}"></div></section>`;
}

function fieldChoices(field) {
  const key = field.id;
  const label = String(field.label || '').toLowerCase();
  if (key === 'bon_de') return ['', 'Dépannage', 'Entretien', 'Installation', 'Formation', 'Mise en service', 'Visite'];
  if (/conformit[eé]|validation|[eé]tat|contr[oô]le|stabilit[eé]|fonctionnement|protection|arr[eê]t|usure|changement.*lame/.test(label)) return ['', 'Bon', 'Mauvais', 'Inexistant', 'Non applicable'];
  if (/type.*intervention/.test(label)) return ['', 'Curatif', 'Préventif', 'Installation', 'Formation', 'Diagnostic'];
  if (/nombre.*passage/.test(label)) return ['', '1', '2', '3', '4 et plus'];
  if (/oui|livr[eé]|accord|factur|garantie|contrat/.test(label)) return ['', 'Oui', 'Non', 'Non applicable'];
  return ['', 'Oui', 'Non', 'Non applicable', 'Autre'];
}

function isClientField(field) {
  const label = String(field.label || '').toLowerCase();
  return /^(client\(s\)|client|soci[eé]t[eé]|raison sociale)$/i.test(label) || field.id === 'client';
}

function bindKizeoForm(definition) {
  formHost.querySelectorAll('.kizeo-table').forEach((table) => addTableRow(table));
  formHost.querySelectorAll('.add-kizeo-row').forEach((button) => button.addEventListener('click', () => addTableRow(button.closest('.kizeo-table'))));
  formHost.querySelectorAll('.signatureCanvas').forEach((canvas) => setupSignatureCanvas(canvas));
  formHost.querySelectorAll('.clear-signature').forEach((button) => button.addEventListener('click', () => clearSignature(button.dataset.target)));
  formHost.querySelectorAll('[data-role="client"]').forEach((input) => {
    input.addEventListener('focus', () => { activeClientInput = input; });
    input.addEventListener('input', () => { activeClientInput = input; updateSummary(); searchClients(input.value.trim()); });
  });
  formHost.addEventListener('input', updateSummary);
  formHost.addEventListener('change', updateSummary);
  if (!definition.fields.some((field) => /fa-calendar/.test(field.icon || ''))) {
    canonical.date.value = localDateTimeValue();
  }
}

function addTableRow(table, values = {}) {
  const container = table.querySelector('.kizeo-table-rows');
  const columns = JSON.parse(container.dataset.columns || '[]');
  const row = document.createElement('div');
  row.className = 'kizeo-table-row';
  row.style.setProperty('--kizeo-columns', columns.length + 1);
  row.innerHTML = `${columns.map((column) => `<input data-column="${escapeAttr(column.id)}" aria-label="${escapeAttr(column.label)}" placeholder="${escapeAttr(column.label)}" value="${escapeAttr(values[column.id] || '')}">`).join('')}<button class="icon-btn remove-kizeo-row" type="button" aria-label="Supprimer la ligne">×</button>`;
  row.querySelector('.remove-kizeo-row').addEventListener('click', () => { row.remove(); if (!container.children.length) addTableRow(table); updateSummary(); });
  row.addEventListener('input', () => {
    const last = container.lastElementChild;
    if (row === last && [...row.querySelectorAll('[data-column]')].some((input) => input.value.trim())) addTableRow(table);
    updateSummary();
  });
  container.appendChild(row);
}

function setupSignatureCanvas(canvas) {
  const key = canvas.dataset.kizeo;
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const width = canvas.getBoundingClientRect().width || 320;
  canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(170 * ratio);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio); context.lineWidth = 2; context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = '#111111';
  let drawing = false;
  const point = (event) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  canvas.addEventListener('pointerdown', (event) => { event.preventDefault(); drawing = true; signatureState[key] = true; const p = point(event); context.beginPath(); context.moveTo(p.x, p.y); canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => { if (!drawing) return; event.preventDefault(); const p = point(event); context.lineTo(p.x, p.y); context.stroke(); });
  canvas.addEventListener('pointerup', () => { drawing = false; }); canvas.addEventListener('pointercancel', () => { drawing = false; });
}

function clearSignature(key) {
  const canvas = formHost.querySelector(`.signatureCanvas[data-kizeo="${cssEscape(key)}"]`);
  if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  signatureState[key] = false;
}

function searchClients(query) {
  clearTimeout(searchTimer);
  closeClientResults();
  if (!dolibarrConfigured || query.length < 2) return;
  searchTimer = setTimeout(async () => {
    try {
      const response = await fetch(`/api/dolibarr/thirdparties?q=${encodeURIComponent(query)}`);
      if (!response.ok) return;
      const { thirdparties } = await response.json();
      if (!activeClientInput || !thirdparties.length) return;
      const results = document.createElement('div');
      results.className = 'search-results open dynamic-client-results';
      results.innerHTML = thirdparties.map((client) => `<button class="search-result" type="button" data-client="${escapeAttr(JSON.stringify(client))}"><strong>${escapeHtml(client.name)}</strong><span>${escapeHtml([client.zip, client.town, client.email].filter(Boolean).join(' · '))}</span></button>`).join('');
      activeClientInput.closest('.field')?.appendChild(results);
      results.addEventListener('click', (event) => chooseClient(event));
    } catch { /* Recherche facultative. */ }
  }, 280);
}

function chooseClient(event) {
  const button = event.target.closest('[data-client]');
  if (!button || !activeClientInput) return;
  const client = JSON.parse(button.dataset.client);
  document.querySelector('#dolibarrThirdpartyId').value = client.id || '';
  activeClientInput.value = client.name || '';
  fillByLabel(/adresse/i, [client.address, [client.zip, client.town].filter(Boolean).join(' ')].filter(Boolean).join('\n'));
  fillByLabel(/t[eé]l/i, client.phone || ''); fillByLabel(/mail|e-mail/i, client.email || '');
  closeClientResults(); updateSummary();
}

function closeClientResults() { formHost.querySelectorAll('.dynamic-client-results').forEach((element) => element.remove()); }

function fillByLabel(regex, value) {
  const input = [...formHost.querySelectorAll('[data-kizeo]')].find((element) => regex.test(labelFor(element.dataset.kizeo)));
  if (input && !input.value) input.value = value;
}

function labelFor(fieldId) {
  return schemas.types[selectedType]?.fields?.find((field) => field.id === fieldId)?.label || fieldId;
}

function valuesByField() {
  const fields = {};
  formHost.querySelectorAll('[data-kizeo]').forEach((input) => {
    if (input.matches('canvas')) return;
    fields[input.dataset.kizeo] = input.type === 'checkbox' ? (input.checked ? '1' : '') : input.value.trim();
  });
  return fields;
}

function valueByIds(fields, ids, labelRegex) {
  for (const id of ids) if (fields[id]) return fields[id];
  const matched = Object.entries(fields).find(([id, value]) => value && labelRegex?.test(labelFor(id)));
  return matched?.[1] || '';
}

function deriveCanonical(fields, definition) {
  canonical.date.value = valueByIds(fields, ['date_et_heure1', 'date_et_heure', 'intervention_du', 'date'], /date.*heure|intervention du|appel du/i) || localDateTimeValue();
  canonical.client.value = valueByIds(fields, ['client', 'client_s_', 'clients', 'client2', 'societe'], /^client|soci[eé]t[eé]|raison sociale/i);
  canonical.reference.value = valueByIds(fields, ['ref_cde_client', 'reference_client', 'reference'], /r[eé]f.*client|commande/i);
  canonical.phone.value = valueByIds(fields, ['tel_', 'tel', 'reference2', 'clients1'], /t[eé]l/i);
  canonical.mail.value = valueByIds(fields, ['mail', 'reference4', 'adresse'], /mail|e-mail/i);
  canonical.address.value = valueByIds(fields, ['adresse', 'reference3', 'n_de_tel'], /^adresse/i);
  canonical.machine.value = valueByIds(fields, ['type_materiel_', 'machines1', 'machines', 'machine', 'materiel_s_'], /machine|mat[eé]riel|[eé]quipement/i);
  canonical.serial.value = valueByIds(fields, ['n_de_matricule_', 'n_de_serie', 'champ_de_saisie2', 'n_'], /s[eé]rie|matricule|n°/i);
  canonical.bonDe.value = valueByIds(fields, ['bon_de', 'types_d_intervention', 'type_d_intervention'], /^bon de|type.*intervention/i) || definition.shortLabel;
  canonical.work.value = valueByIds(fields, ['travail_effectue_', 'travail_effectue', 'details_de_l_intervention', 'observations_technicien', 'motif_s_de_l_intervention'], /d[eé]tail|travail|observ|motif|rem[eè]de|rapport/i) || definition.label;
  canonical.duration.value = valueByIds(fields, ['temps_passe', 'temps'], /temps pass[eé]|dur[eé]e/i);
  canonical.technician.value = valueByIds(fields, ['non_du_technicien', 'nom_du_technicien1', 'technicien'], /technicien|formateur/i);
  canonical.signatory.value = valueByIds(fields, ['nom_du_signataire_', 'nom_du_signataire'], /signataire|nom.*client/i);
  canonical.arrival.value = valueByIds(fields, ['heures_d_arrivee'], /arriv[eé]e/i);
  canonical.departure.value = valueByIds(fields, ['heure_depart'], /d[eé]part/i);
  canonical.travel.value = valueByIds(fields, ['deplacement'], /d[eé]placement/i);
  canonical.agreement.value = fields.bon_pour_accord || '';
}

function collectItems() {
  const items = [];
  formHost.querySelectorAll('.kizeo-table').forEach((table) => {
    const tableLabel = table.querySelector('h3')?.textContent || '';
    if (!/pi[eè]ce|fourniture|mat[eé]riel|prestation|article/i.test(tableLabel)) return;
    table.querySelectorAll('.kizeo-table-row').forEach((row) => {
      const values = Object.fromEntries([...row.querySelectorAll('[data-column]')].map((input) => [input.dataset.column, input.value.trim()]));
      if (!Object.values(values).some(Boolean)) return;
      const find = (regex) => Object.entries(values).find(([id]) => regex.test(labelFor(id) || id))?.[1] || '';
      const unitPrice = Number(String(find(/prix|p\.u|co[uû]t/i)).replace(',', '.')) || 0;
      const quantity = Number(String(find(/quantit[eé]|qt[eé]|qte/i)).replace(',', '.')) || 1;
      items.push({ code: find(/code|r[eé]f/i), designation: find(/d[eé]signation|libell[eé]|article/i), unit_price: unitPrice, quantity, vat_rate: 20, line_total: Math.round(unitPrice * quantity * 100) / 100 });
    });
  });
  return items.filter((item) => item.code || item.designation);
}

async function collectExtra() {
  const fields = valuesByField();
  formHost.querySelectorAll('.kizeo-table').forEach((table) => {
    const rows = [...table.querySelectorAll('.kizeo-table-row')].map((row) => Object.fromEntries([...row.querySelectorAll('[data-column]')].map((input) => [input.dataset.column, input.value.trim()])))
      .filter((row) => Object.values(row).some(Boolean));
    fields[table.dataset.kizeoTable] = JSON.stringify(rows);
  });
  const photoInputs = [...formHost.querySelectorAll('.photo-upload')];
  const photos = (await Promise.all(photoInputs.map(async (input) => filesToImages(input.files, labelFor(input.dataset.kizeoPhoto))))).flat().slice(0, 6);
  let clientSignature = '';
  let technicianSignature = '';
  formHost.querySelectorAll('.signatureCanvas').forEach((canvas) => {
    const key = canvas.dataset.kizeo; if (!signatureState[key]) return;
    const data = canvas.toDataURL('image/png');
    fields[key] = 'Signature jointe';
    if (/client|accord|signataire/i.test(labelFor(key))) clientSignature ||= data;
    else technicianSignature ||= data;
  });
  if (!clientSignature) {
    const last = [...formHost.querySelectorAll('.signatureCanvas')].reverse().find((canvas) => signatureState[canvas.dataset.kizeo]);
    if (last) clientSignature = last.toDataURL('image/png');
  }
  return { fields, checklist: [], days: [], photos, privatePhotos: [], signature_client: clientSignature, signature_technicien: technicianSignature };
}

async function filesToImages(fileList, prefix) {
  return Promise.all([...fileList].slice(0, 6).map(async (file) => ({ name: `${prefix} — ${file.name}`, data: await resizeImage(file) })));
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error(`Impossible de lire ${file.name}.`));
    reader.onload = () => { const image = new Image(); image.onerror = () => reject(new Error(`L’image ${file.name} est illisible.`)); image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height)); const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', .78));
    }; image.src = reader.result; }; reader.readAsDataURL(file);
  });
}

function updateSummary() {
  const fields = valuesByField();
  const definition = schemas?.types?.[selectedType];
  if (!definition) return;
  deriveCanonical(fields, definition);
  const items = collectItems(); const total = items.reduce((sum, item) => sum + item.line_total, 0);
  itemsJson.value = JSON.stringify(items);
  document.querySelector('#summaryClient').textContent = canonical.client.value || 'À renseigner';
  document.querySelector('#summaryItems').textContent = String(items.length);
  document.querySelector('#summaryTotal').textContent = money.format(total);
}

companyCards.addEventListener('click', (event) => { const card = event.target.closest('[data-company]'); if (card) selectCompany(card.dataset.company); });
typeCards.addEventListener('click', (event) => { const card = event.target.closest('[data-type]'); if (card) selectType(card.dataset.type); });
document.addEventListener('click', (event) => { if (!event.target.closest('.field')) closeClientResults(); });

form.addEventListener('submit', async (event) => {
  event.preventDefault(); updateSummary();
  const definition = schemas.types[selectedType];
  const button = document.querySelector('#submitButton'); button.disabled = true; button.textContent = 'Préparation du PDF…';
  try {
    const extra = await collectExtra(); deriveCanonical(extra.fields, definition);
    extraJson.value = JSON.stringify(extra);
    document.querySelector('#signatureClientInput').value = extra.signature_client;
    document.querySelector('#signatureTechInput').value = extra.signature_technicien;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (!navigator.onLine) { await saveOffline(payload, button); return; }
    let response;
    try { response = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams(payload) }); }
    catch (error) { if (!window.OfflineStore) throw error; await saveOffline(payload, button); return; }
    const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Impossible d’enregistrer le document.');
    const download = document.createElement('a'); download.href = `/api/bons/${result.id}/pdf?download=1`; download.download = `${result.publicRef}.pdf`; download.hidden = true; document.body.appendChild(download); download.click(); download.remove();
    const warning = result.sync && result.sync.ok === false ? ' La synchronisation Dolibarr devra être relancée depuis l’historique.' : '';
    showToast(`${result.publicRef} est enregistré. Le PDF correspondant démarre.${warning}`, Boolean(warning)); button.textContent = 'Document enregistré';
    setTimeout(() => { window.location.href = `/historique.html?created=${result.id}`; }, 1800);
  } catch (error) { showToast(error.message || 'Impossible d’enregistrer le document.', true); button.disabled = false; button.textContent = 'Enregistrer et télécharger le PDF'; }
});

async function saveOffline(payload, button) {
  if (!window.OfflineStore) throw new Error('Le stockage hors ligne n’est pas encore disponible. Rechargez la page une fois avec Internet.');
  button.textContent = 'Enregistrement hors connexion…'; const entry = await window.OfflineStore.queueBon(payload, { endpoint: form.action }); await window.GCRSPWA?.requestBackgroundSync();
  showToast(`${entry.localRef} est conservé sur cet appareil. Le PDF sera créé dès le retour d’Internet.`); button.textContent = 'Document enregistré hors connexion';
  window.setTimeout(() => { window.location.href = `/historique.html?queued=${encodeURIComponent(entry.localId)}`; }, 1600);
}

function configureDolibarr(config) {
  dolibarrConfigured = Boolean(config.dolibarr?.configured); const notice = document.querySelector('#doliNotice'); const badge = document.querySelector('#connectionBadge');
  if (!navigator.onLine) { notice.className = 'notice notice-warning'; notice.textContent = 'Hors connexion : le bon sera conservé sur cet appareil puis envoyé automatiquement.'; badge.className = 'badge badge-warning'; badge.textContent = 'Hors connexion'; }
  else if (dolibarrConfigured) { notice.className = 'notice notice-success'; notice.textContent = 'Dolibarr configuré : fiche, commande éventuelle, facture brouillon et PDF GED.'; badge.className = 'badge badge-success'; badge.textContent = 'Dolibarr connecté'; }
  else { notice.className = 'notice notice-warning'; notice.textContent = 'Mode local : configurez la clé API Render pour synchroniser.'; badge.className = 'badge badge-warning'; badge.textContent = 'Mode local'; }
}

function showToast(message, error = false) { toast.textContent = message; toast.className = `toast show${error ? ' error' : ''}`; setTimeout(() => { toast.className = 'toast'; }, 6000); }
function typeIcon(type) { return ({ intervention: 'BI', visite_massicot: 'VT', mise_en_service: 'MES', fiche_machine: 'FM', livraison: 'BL', commande: 'BC', devis: 'DEV', contrat: 'CTR', note_frais: 'NDF', indemnite: 'IK', reprise_depot: 'REP', affutage: 'AFF' })[type] || 'DOC'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }
function cssEscape(value) { return String(value).replace(/(["\\])/g, '\\$1'); }

initialize();
