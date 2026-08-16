const form = document.querySelector('#interventionForm');
const rowsContainer = document.querySelector('#itemRows');
const itemsJson = document.querySelector('#itemsJson');
const grandTotal = document.querySelector('#grandTotal');
const clientInput = document.querySelector('#clientInput');
const clientResults = document.querySelector('#clientResults');
const clientHint = document.querySelector('#clientHint');
const dolibarrThirdpartyId = document.querySelector('#dolibarrThirdpartyId');
const signatureCanvas = document.querySelector('#signatureCanvas');
const signatureInput = document.querySelector('#signatureInput');
const signatureHint = document.querySelector('#signatureHint');
const toast = document.querySelector('#toast');
const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
let signatureDrawn = false;
let rowCounter = 0;
let dolibarrConfigured = false;
let searchTimer;

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

document.querySelector('#dateHeureInput').value = localDateTimeValue();
const nowTime = new Date().toTimeString().slice(0, 5);
document.querySelector('#arrivalInput').value = nowTime;

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
      code: row.querySelector('.item-code').value.trim(),
      designation: row.querySelector('.item-designation').value.trim(),
      unit_price: unitPrice,
      quantity,
      vat_rate: Number(row.querySelector('.item-vat').value) || 0,
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
rowsContainer.addEventListener('input', updateItems);
rowsContainer.addEventListener('click', (event) => {
  const button = event.target.closest('.remove-item');
  if (!button) return;
  button.closest('.data-row').remove();
  updateItems();
});
addItem();

clientInput.addEventListener('input', () => {
  dolibarrThirdpartyId.value = '';
  document.querySelector('#summaryClient').textContent = clientInput.value.trim() || 'À renseigner';
  clearTimeout(searchTimer);
  if (!dolibarrConfigured || clientInput.value.trim().length < 2) { closeClientResults(); return; }
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

function setupSignature() {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = signatureCanvas.getBoundingClientRect();
  signatureCanvas.width = Math.floor(rect.width * ratio);
  signatureCanvas.height = Math.floor(170 * ratio);
  const context = signatureCanvas.getContext('2d');
  context.scale(ratio, ratio);
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#173b57';
}

let drawing = false;
function signaturePoint(event) {
  const rect = signatureCanvas.getBoundingClientRect();
  const pointer = event.touches ? event.touches[0] : event;
  return { x: pointer.clientX - rect.left, y: pointer.clientY - rect.top };
}
function startDrawing(event) {
  event.preventDefault(); drawing = true; signatureDrawn = true;
  const point = signaturePoint(event); const context = signatureCanvas.getContext('2d');
  context.beginPath(); context.moveTo(point.x, point.y);
}
function draw(event) {
  if (!drawing) return;
  event.preventDefault(); const point = signaturePoint(event); const context = signatureCanvas.getContext('2d');
  context.lineTo(point.x, point.y); context.stroke();
}
function stopDrawing() { drawing = false; }

setupSignature();
signatureCanvas.addEventListener('pointerdown', startDrawing);
signatureCanvas.addEventListener('pointermove', draw);
signatureCanvas.addEventListener('pointerup', stopDrawing);
signatureCanvas.addEventListener('pointerleave', stopDrawing);
document.querySelector('#clearSignature').addEventListener('click', () => {
  signatureCanvas.getContext('2d').clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  signatureDrawn = false; signatureInput.value = ''; signatureHint.textContent = 'Signez avec le doigt, un stylet ou la souris.';
});

const arrival = document.querySelector('#arrivalInput');
const departure = document.querySelector('#departureInput');
const duration = document.querySelector('#durationInput');
function updateDuration() {
  if (!arrival.value || !departure.value) return;
  const [ah, am] = arrival.value.split(':').map(Number); const [dh, dm] = departure.value.split(':').map(Number);
  let minutes = (dh * 60 + dm) - (ah * 60 + am); if (minutes < 0) minutes += 1440;
  duration.value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}h${String(minutes % 60).padStart(2, '0')}`;
}
arrival.addEventListener('change', updateDuration); departure.addEventListener('change', updateDuration);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  updateItems();
  if (!signatureDrawn) {
    signatureHint.textContent = 'La signature du client est obligatoire.'; signatureHint.style.color = '#b43f44';
    signatureCanvas.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
  }
  signatureInput.value = signatureCanvas.toDataURL('image/png');
  const button = document.querySelector('#submitButton');
  button.disabled = true;
  button.textContent = 'Génération du PDF…';

  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams(new FormData(form)),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Impossible d’enregistrer le bon.');

    const download = document.createElement('a');
    download.href = `/api/bons/${result.id}/pdf?download=1`;
    download.download = `${result.publicRef}.pdf`;
    download.hidden = true;
    document.body.appendChild(download);
    download.click();
    download.remove();

    const syncWarning = result.sync && result.sync.ok === false
      ? ' Le bon est enregistré, mais la synchronisation Dolibarr devra être relancée depuis l’historique.'
      : '';
    showToast(`Bon ${result.publicRef} enregistré. Le téléchargement du PDF démarre.${syncWarning}`, Boolean(syncWarning));
    button.textContent = 'Bon enregistré';
    setTimeout(() => { window.location.href = `/historique.html?created=${result.id}`; }, 1800);
  } catch (error) {
    showToast(error.message || 'Impossible d’enregistrer le bon.', true);
    button.disabled = false;
    button.textContent = 'Enregistrer le bon signé';
  }
});

function showToast(message, error = false) {
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  setTimeout(() => { toast.className = 'toast'; }, 6000);
}

async function configure() {
  try {
    const response = await fetch('/api/config'); const config = await response.json();
    dolibarrConfigured = Boolean(config.dolibarr?.configured);
    const notice = document.querySelector('#doliNotice');
    if (dolibarrConfigured) {
      notice.className = 'notice notice-success';
      notice.textContent = 'Dolibarr est configuré : la synchronisation sera lancée après l’enregistrement.';
      clientHint.textContent = 'Saisissez au moins deux caractères pour rechercher un client Dolibarr.';
    }
  } catch { dolibarrConfigured = false; }
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }
configure();
