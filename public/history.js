const rows = document.querySelector('#historyRows');
const filters = document.querySelector('#filters');
const toast = document.querySelector('#toast');
let dolibarrConfigured = false;
const typeLabels = { intervention: 'Intervention', visite_massicot: 'Visite massicot', mise_en_service: 'Mise en service', fiche_machine: 'Fiche machine' };
const companies = {
  gcrs: { label: 'GCRS', color: '#173b57' },
  dimensions: { label: 'Dimensions', color: '#9b1b30' },
  esi: { label: 'ESI', color: '#5553a6' },
  abeg: { label: 'ABEG', color: '#1b5b8c' },
  arboreal: { label: 'ARBOREAL', color: '#43845b' },
  clementz: { label: 'Clementz', color: '#515b63' },
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const dateTime = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date inconnue' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date); };

function syncBadge(state) {
  const states = { synced: ['Synchronisé', 'badge-success'], syncing: ['En cours', 'badge-warning'], pending: ['À synchroniser', 'badge-warning'], offline_pending: ['Hors ligne', 'badge-warning'], error: ['Erreur', 'badge-error'], not_configured: ['Local', 'badge-muted'] };
  const [label, css] = states[state] || ['En attente', 'badge-muted'];
  return `<span class="badge ${css}"${state === 'error' ? ' title="Erreur de synchronisation"' : ''}>${label}</span>`;
}

function companyBadge(companyId) {
  const company = companies[companyId] || { label: companyId || 'Non classé', color: '#667d8d' };
  return `<span class="company-badge" style="--company-color:${company.color}">${escapeHtml(company.label)}</span>`;
}

function matchesLocalFilters(bon, search, company, sync) {
  const matchesSearch = !search || [bon.public_ref, bon.localRef, bon.client, bon.ref_cde_client, bon.non_du_technicien]
    .some((value) => String(value || '').toLowerCase().includes(search));
  const matchesCompany = !company || bon.bon_variant === company;
  const matchesSync = !sync || bon.sync_state === sync;
  return matchesSearch && matchesCompany && matchesSync;
}

async function loadHistory() {
  rows.innerHTML = '<tr><td colspan="7" class="empty">Chargement…</td></tr>';
  let pending = [];
  let bons = [];
  let cached = false;
  try {
    pending = await window.OfflineStore?.getPending() || [];
  } catch { pending = []; }
  try {
    const query = new URLSearchParams(new FormData(filters));
    [...query].forEach(([key, value]) => { if (!value) query.delete(key); });
    const response = await fetch(`/api/bons?${query}`);
    if (!response.ok) throw new Error('Impossible de charger les interventions.');
    ({ bons } = await response.json());
    await window.OfflineStore?.cacheServerBons(bons);
  } catch {
    cached = true;
    try { bons = await window.OfflineStore?.getCachedServerBons() || []; } catch { bons = []; }
  }
  const search = document.querySelector('#search').value.trim().toLowerCase();
  const company = document.querySelector('#companyFilter').value;
  const sync = document.querySelector('#syncFilter').value;
  if (cached) bons = bons.filter((bon) => matchesLocalFilters(bon, search, company, sync));
  const visiblePending = pending.filter((entry) => {
    const bon = { ...entry.payload, localRef: entry.localRef, sync_state: 'pending' };
    return matchesLocalFilters(bon, search, company, sync);
  });
  const content = [...visiblePending.map(renderOfflineRow), ...bons.map(renderRow)];
  rows.innerHTML = content.length ? content.join('') : '<tr><td colspan="7" class="empty">Aucune intervention ne correspond aux critères.</td></tr>';
  if (cached && bons.length) showToast('Mode hors connexion : affichage du dernier historique conservé sur cet appareil.');
}

function renderOfflineRow(entry) {
  const bon = entry.payload || {};
  const details = entry.lastError ? `Dernière tentative : ${entry.lastError}` : 'Le PDF sera généré après l’envoi au serveur.';
  return `<tr class="offline-row">
    <td><div class="ref">${escapeHtml(entry.localRef)}</div><div class="sub">${dateTime(bon.date_et_heure1 || entry.createdAt)}</div></td>
    <td>${companyBadge(bon.bon_variant)}</td>
    <td><strong>${escapeHtml(bon.client || 'Non renseigné')}</strong><div class="sub">${escapeHtml(bon.ref_cde_client || 'Sans référence client')}</div></td>
    <td>${escapeHtml(typeLabels[bon.bon_type] || bon.bon_de || 'Document')}<div class="sub">${escapeHtml(bon.type_materiel_ || 'Matériel non renseigné')}</div></td>
    <td>${escapeHtml(bon.non_du_technicien || '—')}</td>
    <td>${syncBadge('offline_pending')}<div class="sub">${escapeHtml(details)}</div></td>
    <td><div class="topbar-actions"><button class="btn btn-ghost btn-small upload-offline" type="button" data-local-id="${escapeHtml(entry.localId)}"${navigator.onLine ? '' : ' disabled'}>Envoyer maintenant</button></div></td>
  </tr>`;
}

function renderRow(bon) {
  const doliRefs = [bon.dolibarr_intervention_id && `FI #${bon.dolibarr_intervention_id}`, bon.dolibarr_order_id && `CO #${bon.dolibarr_order_id}`, bon.dolibarr_invoice_id && `FA #${bon.dolibarr_invoice_id}`].filter(Boolean).join(' · ');
  const syncDetails = [doliRefs, bon.sync_state === 'error' && bon.sync_error].filter(Boolean).join(' · ');
  const canSync = navigator.onLine && dolibarrConfigured && bon.sync_state !== 'synced' && bon.sync_state !== 'syncing';
  return `<tr>
    <td><div class="ref">${escapeHtml(bon.public_ref || `BI-${bon.id}`)}</div><div class="sub">${dateTime(bon.date_et_heure1)}</div></td>
    <td>${companyBadge(bon.bon_variant)}</td>
    <td><strong>${escapeHtml(bon.client || 'Non renseigné')}</strong><div class="sub">${escapeHtml(bon.ref_cde_client || 'Sans référence client')}</div></td>
    <td>${escapeHtml(typeLabels[bon.bon_type] || bon.bon_de || 'Intervention')}<div class="sub">${escapeHtml(bon.type_materiel_ || 'Matériel non renseigné')}</div></td>
    <td>${escapeHtml(bon.non_du_technicien || '—')}</td>
    <td>${syncBadge(bon.sync_state)}<div class="sub">${escapeHtml(syncDetails)}</div></td>
    <td><div class="topbar-actions"><a class="btn btn-secondary btn-small" href="/api/bons/${bon.id}/pdf" target="_blank" rel="noopener">PDF</a>${canSync ? `<button class="btn btn-ghost btn-small sync-btn" type="button" data-id="${bon.id}">Synchroniser</button>` : ''}</div></td>
  </tr>`;
}

async function configure() {
  try {
    const [response, typesResponse] = await Promise.all([fetch('/api/config'), fetch('/api/bon-types')]);
    const config = await response.json();
    dolibarrConfigured = Boolean(config.dolibarr?.configured);
    if (typesResponse.ok) {
      const schemas = await typesResponse.json();
      Object.values(schemas.types || {}).forEach((definition) => { typeLabels[definition.id] = definition.label; });
    }
  } catch { dolibarrConfigured = false; }
  await loadHistory();
}

filters.addEventListener('submit', (event) => { event.preventDefault(); loadHistory(); });
rows.addEventListener('click', async (event) => {
  const uploadButton = event.target.closest('.upload-offline');
  if (uploadButton) {
    uploadButton.disabled = true; uploadButton.textContent = 'Envoi…';
    try {
      await window.OfflineStore.syncOne(uploadButton.dataset.localId);
      showToast('Le bon hors ligne a été envoyé. Son PDF est maintenant disponible.');
      await loadHistory();
    } catch (error) {
      showToast(error.message || 'Envoi impossible.', true);
      uploadButton.disabled = false; uploadButton.textContent = 'Réessayer';
    }
    return;
  }
  const button = event.target.closest('.sync-btn');
  if (!button) return;
  button.disabled = true; button.textContent = 'En cours…';
  try {
    const response = await fetch(`/api/bons/${button.dataset.id}/sync-dolibarr`, { method: 'POST', headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Synchronisation impossible.');
    showToast('Synchronisation Dolibarr terminée.');
    await loadHistory();
  } catch (error) {
    showToast(error.message, true); button.disabled = false; button.textContent = 'Réessayer';
  }
});

function showToast(message, error = false) {
  toast.textContent = message; toast.className = `toast show${error ? ' error' : ''}`;
  setTimeout(() => { toast.className = 'toast'; }, 4500);
}

const pageParameters = new URLSearchParams(location.search);
if (pageParameters.has('created')) showToast('Le bon signé a bien été enregistré.');
if (pageParameters.has('queued')) showToast('Le bon est enregistré hors connexion sur cet appareil.');
document.addEventListener('gcrs:server-updated', loadHistory);
configure();
