const rows = document.querySelector('#historyRows');
const filters = document.querySelector('#filters');
const toast = document.querySelector('#toast');
let dolibarrConfigured = false;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const dateTime = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date inconnue' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date); };

function syncBadge(state) {
  const states = { synced: ['Synchronisé', 'badge-success'], syncing: ['En cours', 'badge-warning'], pending: ['À synchroniser', 'badge-warning'], error: ['Erreur', 'badge-error'], not_configured: ['Local', 'badge-muted'] };
  const [label, css] = states[state] || ['En attente', 'badge-muted'];
  return `<span class="badge ${css}"${state === 'error' ? ' title="Erreur de synchronisation"' : ''}>${label}</span>`;
}

async function loadHistory() {
  rows.innerHTML = '<tr><td colspan="6" class="empty">Chargement…</td></tr>';
  try {
    const query = new URLSearchParams(new FormData(filters));
    [...query].forEach(([key, value]) => { if (!value) query.delete(key); });
    const response = await fetch(`/api/bons?${query}`);
    if (!response.ok) throw new Error('Impossible de charger les interventions.');
    const { bons } = await response.json();
    rows.innerHTML = bons.length ? bons.map(renderRow).join('') : '<tr><td colspan="6" class="empty">Aucune intervention ne correspond aux critères.</td></tr>';
  } catch (error) {
    rows.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderRow(bon) {
  const doliRefs = [bon.dolibarr_intervention_id && `FI #${bon.dolibarr_intervention_id}`, bon.dolibarr_order_id && `CO #${bon.dolibarr_order_id}`, bon.dolibarr_invoice_id && `FA #${bon.dolibarr_invoice_id}`].filter(Boolean).join(' · ');
  const canSync = dolibarrConfigured && bon.sync_state !== 'synced' && bon.sync_state !== 'syncing';
  return `<tr>
    <td><div class="ref">${escapeHtml(bon.public_ref || `BI-${bon.id}`)}</div><div class="sub">${dateTime(bon.date_et_heure1)}</div></td>
    <td><strong>${escapeHtml(bon.client || 'Non renseigné')}</strong><div class="sub">${escapeHtml(bon.ref_cde_client || 'Sans référence client')}</div></td>
    <td>${escapeHtml(bon.bon_de || '—')}<div class="sub">${escapeHtml(bon.type_materiel_ || 'Matériel non renseigné')}</div></td>
    <td>${escapeHtml(bon.non_du_technicien || '—')}</td>
    <td>${syncBadge(bon.sync_state)}<div class="sub">${escapeHtml(doliRefs || bon.sync_error || '')}</div></td>
    <td><div class="topbar-actions"><a class="btn btn-secondary btn-small" href="/api/bons/${bon.id}/pdf" target="_blank" rel="noopener">PDF</a>${canSync ? `<button class="btn btn-ghost btn-small sync-btn" type="button" data-id="${bon.id}">Synchroniser</button>` : ''}</div></td>
  </tr>`;
}

async function configure() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    dolibarrConfigured = Boolean(config.dolibarr?.configured);
  } catch { dolibarrConfigured = false; }
  await loadHistory();
}

filters.addEventListener('submit', (event) => { event.preventDefault(); loadHistory(); });
rows.addEventListener('click', async (event) => {
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

if (new URLSearchParams(location.search).has('created')) showToast('Le bon signé a bien été enregistré.');
configure();
