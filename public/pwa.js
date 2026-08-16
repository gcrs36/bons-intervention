(function initializePwa() {
  'use strict';

  let deferredInstallPrompt = null;
  let installButton;
  let networkStatus;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function showMessage(message, error = false) {
    const toast = document.querySelector('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show${error ? ' error' : ''}`;
    window.setTimeout(() => { toast.className = 'toast'; }, 6000);
  }

  async function updateNetworkStatus() {
    if (!networkStatus) return;
    let count = 0;
    try { count = (await window.OfflineStore?.getPending())?.length || 0; } catch { /* stockage facultatif */ }
    const online = navigator.onLine;
    networkStatus.className = `network-status ${online ? 'is-online' : 'is-offline'}`;
    networkStatus.querySelector('.network-label').textContent = online ? 'En ligne' : 'Hors connexion';
    const queue = networkStatus.querySelector('.network-queue');
    queue.textContent = count ? `${count} bon${count > 1 ? 's' : ''} en attente` : 'Aucun bon en attente';
    networkStatus.querySelector('button').hidden = !online || count === 0;
  }

  async function synchronizePending(showResult = true) {
    if (!window.OfflineStore) return { synced: 0, failed: 0 };
    const result = await window.OfflineStore.syncAll();
    await updateNetworkStatus();
    if (showResult && result.synced) showMessage(`${result.synced} bon${result.synced > 1 ? 's ont' : ' a'} été envoyé${result.synced > 1 ? 's' : ''} au serveur.`);
    if (showResult && result.failed) showMessage(`${result.failed} bon${result.failed > 1 ? 's restent' : ' reste'} en attente.`, true);
    return result;
  }

  async function requestBackgroundSync() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      if ('sync' in registration) await registration.sync.register('sync-gcrs-bons');
    } catch { /* la reprise à l'événement online reste disponible */ }
  }

  function addInterface() {
    networkStatus = document.createElement('div');
    networkStatus.className = 'network-status';
    networkStatus.innerHTML = '<span class="network-dot" aria-hidden="true"></span><span><strong class="network-label">Connexion</strong><small class="network-queue">Vérification…</small></span><button type="button">Envoyer</button>';
    networkStatus.querySelector('button').addEventListener('click', () => synchronizePending(true));
    document.body.appendChild(networkStatus);

    installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'btn btn-secondary btn-small install-app-button';
    installButton.textContent = '⇩ Installer l’application';
    installButton.hidden = isStandalone();
    installButton.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        installButton.hidden = isStandalone();
        return;
      }
      showMessage('Sur iPhone/iPad : Partager → Sur l’écran d’accueil. Sur ordinateur ou Android : utilisez « Installer l’application » dans le menu du navigateur.');
    });
    const actions = window.matchMedia('(max-width: 760px)').matches
      ? document.querySelector('.sidebar')
      : (document.querySelector('.topbar .topbar-actions') || document.querySelector('.topbar'));
    if (actions) actions.appendChild(installButton);
    else document.body.appendChild(installButton);
    updateNetworkStatus();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installButton && !isStandalone()) installButton.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (installButton) installButton.hidden = true;
    showMessage('GCRS Interventions est installée.');
  });
  window.addEventListener('online', async () => {
    await updateNetworkStatus();
    await synchronizePending(true);
  });
  window.addEventListener('offline', () => {
    updateNetworkStatus();
    showMessage('Mode hors connexion activé : les nouveaux bons seront conservés sur cet appareil.');
  });
  document.addEventListener('gcrs:queue-changed', updateNetworkStatus);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        registration.update().catch(() => {});
      } catch (error) {
        console.warn('Installation hors ligne indisponible :', error);
      }
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'GCRS_SYNC_COMPLETE') {
        updateNetworkStatus();
        document.dispatchEvent(new CustomEvent('gcrs:server-updated'));
      }
    });
  }

  window.GCRSPWA = { synchronizePending, requestBackgroundSync, updateNetworkStatus, showMessage };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addInterface);
  else addInterface();
})();
