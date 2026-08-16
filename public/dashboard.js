const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date inconnue' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const typeLabels = { intervention: 'Intervention', visite_massicot: 'Visite massicot', mise_en_service: 'Mise en service', fiche_machine: 'Fiche machine' };

function syncBadge(state) {
  const states = {
    synced: ['Synchronisé', 'badge-success'], syncing: ['En cours', 'badge-warning'],
    pending: ['À synchroniser', 'badge-warning'], offline_pending: ['Hors ligne', 'badge-warning'], error: ['Erreur', 'badge-error'],
    not_configured: ['Local', 'badge-muted'],
  };
  const [label, css] = states[state] || ['En attente', 'badge-muted'];
  return `<span class="badge ${css}">${label}</span>`;
}

async function loadDashboard() {
  try {
    const response = await fetch('/api/dashboard');
    if (!response.ok) throw new Error('Tableau de bord indisponible');
    const data = await response.json();
    document.querySelector('#statToday').textContent = data.totals.today || 0;
    document.querySelector('#statSigned').textContent = data.totals.signed || 0;
    document.querySelector('#statSynced').textContent = data.totals.synced || 0;
    document.querySelector('#statTotal').textContent = data.totals.total || 0;
    const rows = document.querySelector('#recentRows');
    rows.innerHTML = data.recent.length ? data.recent.map((bon) => `<tr>
      <td><div class="ref">${escapeHtml(bon.public_ref)}</div><div class="sub">${formatDate(bon.date_et_heure1)}</div></td>
      <td><strong>${escapeHtml(bon.client || 'Non renseigné')}</strong></td>
      <td>${escapeHtml(typeLabels[bon.bon_type] || bon.bon_de || 'Intervention')}<div class="sub">${escapeHtml((bon.bon_variant || '').toUpperCase())}</div></td>
      <td>${syncBadge(bon.sync_state)}</td>
      <td><a class="btn btn-secondary btn-small" href="/api/bons/${bon.id}/pdf" target="_blank" rel="noopener">PDF</a></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">Aucune intervention pour le moment.</td></tr>';
    updateConnection(data.dolibarrConfigured);
  } catch (error) {
    const [cached, pending] = await Promise.all([
      window.OfflineStore?.getCachedServerBons().catch(() => []) || [],
      window.OfflineStore?.getPending().catch(() => []) || [],
    ]);
    const localRows = pending.map((entry) => ({ ...entry.payload, public_ref: entry.localRef, date_et_heure1: entry.payload.date_et_heure1 || entry.createdAt, sync_state: 'offline_pending', offline: true }));
    const all = [...localRows, ...cached];
    document.querySelector('#statToday').textContent = all.filter((bon) => String(bon.date_et_heure1 || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
    document.querySelector('#statSigned').textContent = cached.filter((bon) => bon.status === 'signed').length;
    document.querySelector('#statSynced').textContent = cached.filter((bon) => bon.sync_state === 'synced').length;
    document.querySelector('#statTotal').textContent = all.length;
    document.querySelector('#recentRows').innerHTML = all.slice(0, 6).map((bon) => `<tr>
      <td><div class="ref">${escapeHtml(bon.public_ref)}</div><div class="sub">${formatDate(bon.date_et_heure1)}</div></td>
      <td><strong>${escapeHtml(bon.client || 'Non renseigné')}</strong></td>
      <td>${escapeHtml(typeLabels[bon.bon_type] || bon.bon_de || 'Intervention')}<div class="sub">${escapeHtml((bon.bon_variant || '').toUpperCase())}</div></td>
      <td>${syncBadge(bon.sync_state)}</td>
      <td>${bon.offline ? '<span class="sub">PDF après reconnexion</span>' : `<a class="btn btn-secondary btn-small" href="/api/bons/${bon.id}/pdf" target="_blank" rel="noopener">PDF</a>`}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">${escapeHtml(error.message)}</td></tr>`;
    updateConnection(false);
  }
}

function updateConnection(configured) {
  const state = document.querySelector('#doliState');
  const message = document.querySelector('#doliMessage');
  const topBadge = document.querySelector('#connectionBadge');
  if (!navigator.onLine) {
    state.className = 'badge badge-warning'; state.textContent = 'Hors ligne';
    topBadge.className = 'badge badge-warning'; topBadge.textContent = 'Mode hors connexion';
    message.textContent = 'Les bons sont conservés sur cet appareil et seront envoyés dès le retour d’Internet.';
  } else if (configured) {
    state.className = 'badge badge-success'; state.textContent = 'Configuré';
    topBadge.className = 'badge badge-success'; topBadge.textContent = 'Dolibarr configuré';
    message.textContent = 'La clé API serveur est présente. La connexion sera testée à la première synchronisation.';
  } else {
    state.className = 'badge badge-warning'; state.textContent = 'À activer';
    topBadge.className = 'badge badge-warning'; topBadge.textContent = 'Dolibarr à configurer';
    message.textContent = 'Activez le module API REST puis ajoutez la clé dans les variables Render.';
  }
}

loadDashboard();
