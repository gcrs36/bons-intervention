const form = document.querySelector('#universalForm');
const typeCards = document.querySelector('#typeCards');
const variantSelect = document.querySelector('#variantSelect');
const familyFields = document.querySelector('#familyFields');
const rowsContainer = document.querySelector('#itemRows');
const itemsJson = document.querySelector('#itemsJson');
const extraJson = document.querySelector('#extraJson');
const grandTotal = document.querySelector('#grandTotal');
const clientInput = document.querySelector('#clientInput');
const clientResults = document.querySelector('#clientResults');
const clientHint = document.querySelector('#clientHint');
const dolibarrThirdpartyId = document.querySelector('#dolibarrThirdpartyId');
const toast = document.querySelector('#toast');
const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

let schemas;
let selectedType = 'intervention';
let dolibarrConfigured = false;
let searchTimer;
let rowCounter = 0;
const signatureState = { client: false, tech: false };

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

document.querySelector('#dateHeureInput').value = localDateTimeValue();

async function initialize() {
  try {
    const [typesResponse, configResponse] = await Promise.all([fetch('/api/bon-types'), fetch('/api/config')]);
    if (!typesResponse.ok) throw new Error('Les modèles de bons sont indisponibles.');
    schemas = await typesResponse.json();
    const config = configResponse.ok ? await configResponse.json() : {};
    configureDolibarr(config);
    renderTypeCards();
    selectType(new URLSearchParams(location.search).get('type') || 'intervention');
    addItem();
    setupSignatures();
  } catch (error) {
    showToast(error.message, true);
    document.querySelector('#submitButton').disabled = true;
  }
}

function renderTypeCards() {
  typeCards.innerHTML = Object.values(schemas.types).map((type) => `
    <button class="type-card" type="button" data-type="${escapeAttr(type.id)}">
      <span class="type-card-icon">${typeIcon(type.id)}</span>
      <span><strong>${escapeHtml(type.label)}</strong><small>${escapeHtml(type.description)}</small></span>
    </button>`).join('');
}

function selectType(typeId) {
  const definition = schemas.types[typeId] || schemas.types.intervention;
  selectedType = definition.id;
  document.querySelector('#bonTypeInput').value = definition.id;
  [...typeCards.querySelectorAll('.type-card')].forEach((card) => card.classList.toggle('selected', card.dataset.type === definition.id));
  variantSelect.innerHTML = definition.variants.map((variantId) => `<option value="${variantId}">${escapeHtml(schemas.variants[variantId].label)}</option>`).join('');
  const requestedVariant = new URLSearchParams(location.search).get('variante');
  variantSelect.value = definition.variants.includes(requestedVariant) ? requestedVariant : definition.variants[0];
  document.querySelector('#pageTitle').textContent = definition.label;
  document.querySelector('#pageLead').textContent = definition.description;
  document.querySelector('#summaryType').textContent = definition.label;
  document.querySelector('#syncInput').checked = Boolean(definition.syncDefault && dolibarrConfigured);
  updateVariant();
}

function updateVariant() {
  const definition = schemas.types[selectedType];
  const variant = schemas.variants[variantSelect.value];
  document.querySelector('#bonVariantInput').value = variant.id;
  document.querySelector('#summaryVariant').textContent = variant.label;
  document.querySelector('.summary-head').style.background = variant.color;
  document.querySelector('#itemsCard').hidden = selectedType === 'fiche_machine';
  document.querySelector('#machineInput').required = ['intervention', 'visite_massicot'].includes(selectedType);
  document.querySelector('#machineRequired').hidden = !document.querySelector('#machineInput').required;
  const signatureRequired = selectedType !== 'fiche_machine';
  document.querySelector('#signatoryInput').required = signatureRequired;
  document.querySelector('#signatoryRequired').hidden = !signatureRequired;
  document.querySelector('#agreementRow').hidden = selectedType !== 'intervention';
  document.querySelector('#agreementInput').required = selectedType === 'intervention';
  document.querySelector('#technicianLabel').textContent = selectedType === 'mise_en_service' ? 'Formateur *' : 'Technicien *';
  renderFamilyFields(definition, variant);
}

function renderFamilyFields(definition, variant) {
  if (definition.id === 'intervention') familyFields.innerHTML = interventionFields(variant.id);
  if (definition.id === 'visite_massicot') familyFields.innerHTML = massicotFields(definition.checklist);
  if (definition.id === 'mise_en_service') familyFields.innerHTML = commissioningFields();
  if (definition.id === 'fiche_machine') familyFields.innerHTML = machineSheetFields();
  bindFamilyEvents();
}

function interventionFields(variant) {
  const esiDays = variant === 'esi' ? `<div class="span-2 day-list"><h3>Rapports sur plusieurs jours</h3>${Array.from({ length: 5 }, (_, index) => dayFields(index + 1)).join('')}</div>` : '';
  const variantSpecific = {
    gcrs: field('Véhicule', 'vehicule') + field('Compteur kilométrique', 'compteur_km', 'number'),
    abeg: field('Nom client ABEG', 'nom_client_abeg') + field('Compteur', 'compteur'),
    arboreal: selectField('Nombre de passages', 'nombre_passage', ['', '1', '2', '3', '4 et plus']) + field('Compteur', 'compteur'),
    dimensions: field('Compteur', 'compteur') + field('Déplacement', 'deplacement_detail'),
    esi: field('Références ESI', 'reference_esi') + field('Demande de', 'demande_de'),
  }[variant] || '';
  return `<section class="form-card">
    <div class="form-card-head"><span class="form-card-number">4</span><div><h2>Rapport d’intervention</h2><p class="section-help">Motif, travail réalisé, temps et frais.</p></div></div>
    <div class="form-card-body form-grid">
      ${selectNamedField('Bon de *', 'bon_de', ['Dépannage', 'Entretien', 'Installation', 'Formation', 'Mise en service', 'Visite'], true)}
      ${selectField("Type d’intervention", 'intervention_type', ['', 'Curatif', 'Préventif', 'Installation', 'Formation', 'Diagnostic'])}
      ${field('Panne signalée', 'panne_signalee', 'textarea', true)}
      <div class="field span-2"><label for="workInput">Travail effectué *</label><textarea id="workInput" name="travail_effectue" rows="5" required></textarea></div>
      ${variantSpecific}
      <div class="field span-2 option-grid">
        ${checkField('Intervention à suivre', 'intervention_a_suivre')}
        ${checkField('Sous contrat', 'sous_contrat')}
        ${checkField('Sous garantie', 'sous_garantie')}
        ${checkField('Fonctionnement validé', 'validation_fonctionnement')}
      </div>
      ${esiDays}
      <div class="span-2 expense-grid">
        ${namedField("Heure d’arrivée", 'heures_d_arrivee', 'time', false, 'arrivalInput')}
        ${namedField('Heure de départ', 'heure_depart', 'time', false, 'departureInput')}
        ${namedField('Temps passé', 'temps_passe', 'text', false, 'durationInput')}
        ${namedField('Déplacement', 'deplacement')}
        ${namedField('Kilomètres', 'km', 'number')}
        ${namedField('Repas', 'repas', 'number')}
        ${namedField('Hôtel', 'hotel', 'number')}
        ${namedField('Autoroute / péages (€)', 'autoroute', 'number')}
      </div>
      ${field('Divers / fournitures', 'divers', 'textarea', true)}
      ${field('Note confidentielle interne', 'note_confidentielle', 'textarea', true)}
    </div>
  </section>`;
}

function dayFields(day) {
  return `<details class="day-card" data-day="${day}" ${day === 1 ? 'open' : ''}><summary>Jour ${day}</summary><div class="form-grid">
    <div class="field"><label>Date</label><input data-day-field="date" type="date"></div>
    <div class="field"><label>Main-d’œuvre sur site</label><input data-day-field="on_site" placeholder="ex. 07h30"></div>
    <div class="field"><label>Nombre de déplacements</label><input data-day-field="trips" type="number" min="0" step="1"></div>
    <div class="field"><label>Trajet aller</label><input data-day-field="outbound" placeholder="ex. 01h15"></div>
    <div class="field"><label>Trajet retour</label><input data-day-field="return" placeholder="ex. 01h10"></div>
    <div class="field"><label>Kilomètres A/R</label><input data-day-field="km" type="number" min="0" step="1"></div>
    <div class="field"><label>Péages</label><input data-day-field="tolls" type="number" min="0" step="0.01"></div>
    <div class="field"><label>Parking</label><input data-day-field="parking" type="number" min="0" step="0.01"></div>
    <div class="field"><label>Repas</label><input data-day-field="meals" type="number" min="0" step="1"></div>
    <div class="field"><label>Hôtel</label><input data-day-field="hotel" type="number" min="0" step="1"></div>
    <div class="field span-2"><label>Rapport du jour</label><textarea data-day-field="report" rows="4"></textarea></div>
  </div></details>`;
}

function massicotFields(checklist) {
  const rows = checklist.map((item) => `${item.groupLabel ? `<div class="check-group"><strong>${escapeHtml(item.group)} — ${escapeHtml(item.groupLabel)}</strong></div>` : ''}
    <div class="check-row" data-code="${escapeAttr(item.code)}" data-group="${escapeAttr(item.group)}" data-group-label="${escapeAttr(item.groupLabel || '')}" data-label="${escapeAttr(item.label)}">
      <div class="check-label"><strong>${escapeHtml(item.code)}</strong><span>${escapeHtml(item.label)}</span></div>
      <select class="check-state" aria-label="État ${escapeAttr(item.code)}">${schemas.checklistStates.map((state) => `<option>${escapeHtml(state)}</option>`).join('')}</select>
      <input class="check-comment" type="text" aria-label="Observation ${escapeAttr(item.code)}" placeholder="Observation si nécessaire">
    </div>`).join('');
  return `<section class="form-card">
    <div class="form-card-head"><span class="form-card-number">4</span><div><h2>Visite trimestrielle massicot</h2><p class="section-help">La grille reprend tous les points A1 à D38 de Kizeo.</p></div></div>
    <div class="form-card-body form-grid">
      ${selectField('Trimestre *', 'trimestre', ['1er trimestre', '2e trimestre', '3e trimestre', '4e trimestre'], false, true)}
      ${field('N° identification', 'numero_identification')}
      ${field('Marque', 'marque')}${field('Type', 'type_machine')}
    </div>
    <div class="checklist-editor">${rows}</div>
    <div class="form-card-body form-grid blade-fields">
      ${selectField('Changement de lame', 'changement_lame', ['', 'Oui', 'Non', 'Impossible'])}
      ${field('Taille de lame', 'taille_lame')}
      ${selectField('État de la lame enlevée', 'etat_lame', ['', 'Bon', 'Moyen', 'Mauvais'])}
      ${selectField('Usure de la lame', 'usure_lame', ['', 'Normale', 'Anormale'])}
      ${field('Observation sur la lame', 'commentaire_lame', 'textarea', true)}
      ${selectField("Conformité de l’équipement", 'conformite', ['', 'Conforme', 'Non conforme', 'Conforme avec réserves'], false, true)}
      ${field('Non-conformités et actions recommandées', 'non_conformite', 'textarea', true)}
      ${field('Fournitures', 'fournitures', 'textarea', true)}
      ${field('Divers visible par le client', 'divers', 'textarea', true)}
      ${field('Divers confidentiel', 'divers_confidentiel', 'textarea', true)}
    </div>
  </section>`;
}

function commissioningFields() {
  return `<section class="form-card"><div class="form-card-head"><span class="form-card-number">4</span><div><h2>Mise en service et formation</h2><p class="section-help">Procès-verbal issu du formulaire Kizeo.</p></div></div><div class="form-card-body form-grid">
    ${field('Contact', 'contact')}${field('Supports de formation', 'supports_formation')}
    ${field('Liste / intitulé de formation', 'liste_formation')}
    ${field('Numéros de série', 'numeros_serie', 'textarea', true)}
    <div class="field span-2"><label>Observations *</label><textarea name="travail_effectue" data-extra="observations" rows="5" required></textarea></div>
    ${field('Présences à la formation', 'presences_formation', 'textarea', true)}
  </div></section>`;
}

function machineSheetFields() {
  return `<section class="form-card"><div class="form-card-head"><span class="form-card-number">4</span><div><h2>Fiche machine atelier</h2><p class="section-help">Réception, diagnostic et décision atelier.</p></div></div><div class="form-card-body form-grid">
    ${field('Provenance', 'provenance')}${selectField('But', 'but', ['', 'Diagnostic', 'Réparation', 'Contrôle', 'Préparation', 'Autre'])}
    ${field('Compteur', 'compteur', 'number')}${selectField('Issue', 'issue', ['', 'Réparée', 'À suivre', 'Non réparée', 'Retour client'])}
    ${selectField('Devis', 'devis', ['', 'À faire', 'Envoyé', 'Accepté', 'Refusé', 'Sans objet'])}
    ${selectField('Mise au rebut', 'mise_au_rebut', ['', 'Non', 'Oui', 'À décider'])}
    <div class="field span-2"><label>Observations *</label><textarea name="travail_effectue" data-extra="observation" rows="5" required></textarea></div>
    ${field('Actions réalisées', 'action_realisee', 'textarea', true)}
  </div></section>`;
}

function field(label, key, type = 'text', full = false) {
  const css = full ? 'field span-2' : 'field';
  if (type === 'textarea') return `<div class="${css}"><label>${escapeHtml(label)}</label><textarea data-extra="${escapeAttr(key)}" rows="3"></textarea></div>`;
  if (type === 'checkbox') return checkField(label, key);
  return `<div class="${css}"><label>${escapeHtml(label)}</label><input data-extra="${escapeAttr(key)}" type="${type}"${type === 'number' ? ' step="0.01"' : ''}></div>`;
}

function namedField(label, name, type = 'text', required = false, id = '') {
  return `<div class="field"><label${id ? ` for="${id}"` : ''}>${escapeHtml(label)}${required ? ' *' : ''}</label><input${id ? ` id="${id}"` : ''} name="${name}" type="${type}"${required ? ' required' : ''}${type === 'time' ? ' step="300"' : ''}${type === 'number' ? ' min="0" step="0.01"' : ''}></div>`;
}

function selectField(label, key, options, full = false, required = false) {
  return `<div class="field${full ? ' span-2' : ''}"><label>${escapeHtml(label)}</label><select data-extra="${escapeAttr(key)}"${required ? ' required' : ''}>${options.map((option) => `<option value="${escapeAttr(option)}">${escapeHtml(option || 'Sélectionner…')}</option>`).join('')}</select></div>`;
}

function selectNamedField(label, name, options, required = false) {
  return `<div class="field"><label>${escapeHtml(label)}</label><select name="${name}"${required ? ' required' : ''}>${options.map((option) => `<option value="${escapeAttr(option)}">${escapeHtml(option)}</option>`).join('')}</select></div>`;
}

function checkField(label, key) {
  return `<label class="checkbox compact-check"><input data-extra="${escapeAttr(key)}" type="checkbox" value="1"><span>${escapeHtml(label)}</span></label>`;
}

function bindFamilyEvents() {
  const arrival = document.querySelector('#arrivalInput');
  const departure = document.querySelector('#departureInput');
  if (arrival) arrival.value = new Date().toTimeString().slice(0, 5);
  if (arrival && departure) {
    arrival.addEventListener('change', updateDuration);
    departure.addEventListener('change', updateDuration);
  }
}

function updateDuration() {
  const arrival = document.querySelector('#arrivalInput');
  const departure = document.querySelector('#departureInput');
  const duration = document.querySelector('#durationInput');
  if (!arrival?.value || !departure?.value || !duration) return;
  const [ah, am] = arrival.value.split(':').map(Number);
  const [dh, dm] = departure.value.split(':').map(Number);
  let minutes = (dh * 60 + dm) - (ah * 60 + am);
  if (minutes < 0) minutes += 1440;
  duration.value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}h${String(minutes % 60).padStart(2, '0')}`;
}

typeCards.addEventListener('click', (event) => {
  const card = event.target.closest('[data-type]');
  if (card) selectType(card.dataset.type);
});
variantSelect.addEventListener('change', updateVariant);

function addItem(values = {}) {
  rowCounter += 1;
  const row = document.createElement('div');
  row.className = 'item-row data-row';
  row.dataset.row = rowCounter;
  row.innerHTML = `
    <input class="item-code" type="text" placeholder="Réf." aria-label="Code pièce" value="${escapeAttr(values.code || '')}">
    <input class="item-designation" type="text" placeholder="Désignation de la pièce" aria-label="Désignation" value="${escapeAttr(values.designation || '')}">
    <input class="item-price" type="number" min="0" step="0.01" aria-label="Prix HT" value="${Number(values.unit_price || 0)}">
    <input class="item-qty" type="number" min="0.01" step="0.01" aria-label="Quantité" value="${Number(values.quantity || 1)}">
    <input class="item-vat" type="number" min="0" step="0.1" aria-label="TVA" value="${Number(values.vat_rate ?? 20)}">
    <span class="item-total">0,00 €</span>
    <button class="icon-btn remove-item" type="button" aria-label="Supprimer la ligne">×</button>`;
  rowsContainer.appendChild(row);
  updateItems();
}

function itemValues() {
  return [...rowsContainer.querySelectorAll('.data-row')].map((row) => {
    const unitPrice = Number(row.querySelector('.item-price').value) || 0;
    const quantity = Number(row.querySelector('.item-qty').value) || 0;
    return {
      code: row.querySelector('.item-code').value.trim(), designation: row.querySelector('.item-designation').value.trim(),
      unit_price: unitPrice, quantity, vat_rate: Number(row.querySelector('.item-vat').value) || 0,
      line_total: Math.round(unitPrice * quantity * 100) / 100,
    };
  }).filter((item) => item.code || item.designation);
}

function updateItems() {
  let total = 0;
  [...rowsContainer.querySelectorAll('.data-row')].forEach((row) => {
    const value = (Number(row.querySelector('.item-price').value) || 0) * (Number(row.querySelector('.item-qty').value) || 0);
    total += value;
    row.querySelector('.item-total').textContent = money.format(value);
  });
  const items = itemValues();
  itemsJson.value = JSON.stringify(items);
  grandTotal.textContent = money.format(total);
  document.querySelector('#summaryTotal').textContent = money.format(total);
  document.querySelector('#summaryItems').textContent = items.length;
}

document.querySelector('#addItem').addEventListener('click', () => addItem());
rowsContainer.addEventListener('input', (event) => {
  updateItems();
  if (!event.target.matches('.item-code, .item-designation')) return;
  const lastRow = [...rowsContainer.querySelectorAll('.data-row')].at(-1);
  if (lastRow && (lastRow.querySelector('.item-code').value.trim() || lastRow.querySelector('.item-designation').value.trim())) addItem();
});
rowsContainer.addEventListener('click', (event) => {
  const button = event.target.closest('.remove-item');
  if (!button) return;
  button.closest('.data-row').remove();
  if (!rowsContainer.querySelector('.data-row')) addItem(); else updateItems();
});

clientInput.addEventListener('input', () => {
  dolibarrThirdpartyId.value = '';
  document.querySelector('#summaryClient').textContent = clientInput.value.trim() || 'À renseigner';
  clearTimeout(searchTimer);
  if (!dolibarrConfigured || clientInput.value.trim().length < 2) return closeClientResults();
  searchTimer = setTimeout(() => searchClients(clientInput.value.trim()), 300);
});

async function searchClients(query) {
  try {
    const response = await fetch(`/api/dolibarr/thirdparties?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Recherche indisponible');
    const { thirdparties } = await response.json();
    clientResults.innerHTML = thirdparties.length ? thirdparties.map((client) => `<button class="search-result" type="button" data-client='${escapeAttr(JSON.stringify(client))}'><strong>${escapeHtml(client.name)}</strong><span>${escapeHtml([client.zip, client.town, client.email].filter(Boolean).join(' · '))}</span></button>`).join('') : '<div class="search-result"><strong>Aucun résultat</strong><span>Le client pourra être créé lors de la synchronisation.</span></div>';
    clientResults.classList.add('open');
  } catch { closeClientResults(); }
}

clientResults.addEventListener('click', (event) => {
  const button = event.target.closest('[data-client]');
  if (!button) return;
  const client = JSON.parse(button.dataset.client);
  clientInput.value = client.name || '';
  dolibarrThirdpartyId.value = client.id || '';
  document.querySelector('#phoneInput').value = client.phone || '';
  document.querySelector('#emailInput').value = client.email || '';
  document.querySelector('#addressInput').value = [client.address, [client.zip, client.town].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  document.querySelector('#summaryClient').textContent = client.name;
  clientHint.textContent = `Client Dolibarr sélectionné · ID ${client.id}`;
  closeClientResults();
});
document.addEventListener('click', (event) => { if (!event.target.closest('.client-search')) closeClientResults(); });
function closeClientResults() { clientResults.classList.remove('open'); }

function setupSignatures() {
  setupSignatureCanvas('client');
  setupSignatureCanvas('tech');
  document.querySelectorAll('.clear-signature').forEach((button) => button.addEventListener('click', () => clearSignature(button.dataset.target)));
}

function setupSignatureCanvas(kind) {
  const canvas = document.querySelector(kind === 'client' ? '#signatureClientCanvas' : '#signatureTechCanvas');
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const width = canvas.getBoundingClientRect().width || 320;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(170 * ratio);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#173b57';
  let drawing = false;
  const point = (event) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  canvas.addEventListener('pointerdown', (event) => { event.preventDefault(); drawing = true; signatureState[kind] = true; const p = point(event); context.beginPath(); context.moveTo(p.x, p.y); canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => { if (!drawing) return; event.preventDefault(); const p = point(event); context.lineTo(p.x, p.y); context.stroke(); });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  canvas.addEventListener('pointercancel', () => { drawing = false; });
}

function clearSignature(kind) {
  const canvas = document.querySelector(kind === 'client' ? '#signatureClientCanvas' : '#signatureTechCanvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  signatureState[kind] = false;
}

async function collectExtra() {
  const fields = {};
  document.querySelectorAll('[data-extra]').forEach((input) => {
    fields[input.dataset.extra] = input.type === 'checkbox' ? (input.checked ? '1' : '') : input.value.trim();
  });
  const checklist = [...document.querySelectorAll('.check-row')].map((row) => ({
    group: row.dataset.group, groupLabel: row.dataset.groupLabel, code: row.dataset.code, label: row.dataset.label,
    state: row.querySelector('.check-state').value, comment: row.querySelector('.check-comment').value.trim(),
  }));
  const days = [...document.querySelectorAll('.day-card')].map((card) => Object.fromEntries([...card.querySelectorAll('[data-day-field]')].map((input) => [input.dataset.dayField, input.value.trim()])));
  const [photos, privatePhotos] = await Promise.all([
    filesToImages(document.querySelector('#photosInput').files),
    filesToImages(document.querySelector('#privatePhotosInput').files),
  ]);
  return {
    fields, checklist, days, photos, privatePhotos,
    signature_technicien: signatureState.tech ? document.querySelector('#signatureTechCanvas').toDataURL('image/png') : '',
  };
}

async function filesToImages(fileList) {
  const files = [...fileList].slice(0, 6);
  return Promise.all(files.map(async (file) => ({ name: file.name, data: await resizeImage(file) })));
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Impossible de lire ${file.name}.`));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(`L’image ${file.name} est illisible.`));
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', .78));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  updateItems();
  if (!form.reportValidity()) return;
  if (selectedType !== 'fiche_machine' && !signatureState.client) {
    document.querySelector('#signatureHint').textContent = 'La signature du client est obligatoire pour ce document.';
    document.querySelector('#signatureHint').style.color = '#b43f44';
    document.querySelector('#signatureClientCanvas').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const button = document.querySelector('#submitButton');
  button.disabled = true;
  button.textContent = 'Préparation du PDF…';
  try {
    const extra = await collectExtra();
    extraJson.value = JSON.stringify(extra);
    document.querySelector('#signatureClientInput').value = signatureState.client ? document.querySelector('#signatureClientCanvas').toDataURL('image/png') : '';
    document.querySelector('#signatureTechInput').value = extra.signature_technicien;
    const response = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams(new FormData(form)) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Impossible d’enregistrer le document.');
    const download = document.createElement('a');
    download.href = `/api/bons/${result.id}/pdf?download=1`;
    download.download = `${result.publicRef}.pdf`;
    download.hidden = true;
    document.body.appendChild(download);
    download.click();
    download.remove();
    const warning = result.sync && result.sync.ok === false ? ' La synchronisation Dolibarr devra être relancée depuis l’historique.' : '';
    showToast(`${result.publicRef} est enregistré. Le téléchargement démarre.${warning}`, Boolean(warning));
    button.textContent = 'Document enregistré';
    setTimeout(() => { window.location.href = `/historique.html?created=${result.id}`; }, 1800);
  } catch (error) {
    showToast(error.message || 'Impossible d’enregistrer le document.', true);
    button.disabled = false;
    button.textContent = 'Enregistrer et télécharger le PDF';
  }
});

function configureDolibarr(config) {
  dolibarrConfigured = Boolean(config.dolibarr?.configured);
  const notice = document.querySelector('#doliNotice');
  const badge = document.querySelector('#connectionBadge');
  if (dolibarrConfigured) {
    notice.className = 'notice notice-success';
    notice.textContent = 'Dolibarr configuré : fiche, commande éventuelle, facture brouillon et PDF GED.';
    badge.className = 'badge badge-success'; badge.textContent = 'Dolibarr connecté';
  } else {
    notice.className = 'notice notice-warning'; notice.textContent = 'Mode local : configurez la clé API Render pour synchroniser.';
    badge.className = 'badge badge-warning'; badge.textContent = 'Mode local';
  }
}

function showToast(message, error = false) {
  toast.textContent = message; toast.className = `toast show${error ? ' error' : ''}`;
  setTimeout(() => { toast.className = 'toast'; }, 6000);
}
function typeIcon(type) { return ({ intervention: 'BI', visite_massicot: 'VT', mise_en_service: 'MES', fiche_machine: 'FM' })[type] || 'DOC'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

initialize();
