(function exposeOfflineStore(root) {
  'use strict';

  const DB_NAME = 'gcrs-interventions-offline';
  const DB_VERSION = 1;
  const OUTBOX = 'outbox';
  const META = 'meta';
  let databasePromise;
  let activeSync;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error('Le stockage hors ligne est indisponible.'));
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OUTBOX)) {
          const outbox = database.createObjectStore(OUTBOX, { keyPath: 'localId' });
          outbox.createIndex('createdAt', 'createdAt');
        }
        if (!database.objectStoreNames.contains(META)) database.createObjectStore(META, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
    });
    return databasePromise;
  }

  async function useStore(name, mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(name, mode);
      const store = transaction.objectStore(name);
      let result;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Échec du stockage local.'));
      transaction.onabort = () => reject(transaction.error || new Error('Stockage local interrompu.'));
      try {
        const request = operation(store);
        if (request) {
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => reject(request.error || new Error('Échec du stockage local.'));
        }
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  }

  function createId() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    return `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function buildLocalReference(payload, localId) {
    const prefixes = { intervention: 'BI', visite_massicot: 'VT', mise_en_service: 'MES', fiche_machine: 'FM' };
    const date = new Date(payload.date_et_heure1 || Date.now());
    const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
    return `${prefixes[payload.bon_type] || 'DOC'}-${year}-LOCAL-${localId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`;
  }

  function notify() {
    if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
      document.dispatchEvent(new CustomEvent('gcrs:queue-changed'));
    }
  }

  async function queueBon(payload, metadata = {}) {
    const localId = payload.client_request_id || createId();
    const normalizedPayload = { ...payload, client_request_id: localId };
    const entry = {
      localId,
      localRef: metadata.localRef || buildLocalReference(normalizedPayload, localId),
      endpoint: metadata.endpoint || '/api/create-bon',
      payload: normalizedPayload,
      state: 'pending',
      attempts: 0,
      lastError: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await useStore(OUTBOX, 'readwrite', (store) => store.put(entry));
    notify();
    return entry;
  }

  async function getPending() {
    const entries = await useStore(OUTBOX, 'readonly', (store) => store.getAll());
    return (entries || []).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async function getEntry(localId) {
    return useStore(OUTBOX, 'readonly', (store) => store.get(localId));
  }

  async function saveEntry(entry) {
    entry.updatedAt = new Date().toISOString();
    await useStore(OUTBOX, 'readwrite', (store) => store.put(entry));
    notify();
  }

  async function removeEntry(localId) {
    await useStore(OUTBOX, 'readwrite', (store) => store.delete(localId));
    notify();
  }

  async function syncOne(localId) {
    const entry = await getEntry(localId);
    if (!entry) return null;
    entry.state = 'syncing';
    entry.attempts = Number(entry.attempts || 0) + 1;
    entry.lastError = '';
    await saveEntry(entry);
    try {
      const response = await fetch(entry.endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-Offline-Replay': '1' },
        body: new URLSearchParams(entry.payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Envoi refusé par le serveur (${response.status}).`);
      await removeEntry(localId);
      return { entry, result };
    } catch (error) {
      entry.state = 'pending';
      entry.lastError = String(error?.message || error || 'Connexion indisponible.').slice(0, 500);
      await saveEntry(entry);
      throw error;
    }
  }

  async function syncAll() {
    if (activeSync) return activeSync;
    if (root.navigator?.onLine === false) return { synced: 0, failed: 0, offline: true };
    activeSync = (async () => {
      const entries = await getPending();
      let synced = 0;
      let failed = 0;
      for (const entry of entries) {
        try {
          await syncOne(entry.localId);
          synced += 1;
        } catch {
          failed += 1;
          if (root.navigator?.onLine === false) break;
        }
      }
      return { synced, failed, offline: false };
    })().finally(() => { activeSync = null; });
    return activeSync;
  }

  async function cacheServerBons(bons) {
    return useStore(META, 'readwrite', (store) => store.put({ key: 'server-bons', value: bons || [], updatedAt: new Date().toISOString() }));
  }

  async function getCachedServerBons() {
    const entry = await useStore(META, 'readonly', (store) => store.get('server-bons'));
    return entry?.value || [];
  }

  root.OfflineStore = {
    queueBon,
    getPending,
    syncOne,
    syncAll,
    removeEntry,
    cacheServerBons,
    getCachedServerBons,
    createId,
  };
})(globalThis);
