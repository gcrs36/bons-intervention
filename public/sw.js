/* global OfflineStore */
'use strict';

importScripts('/offline-store.js');

const CACHE_NAME = 'gcrs-interventions-v4-2-0';
const APP_SHELL = [
  '/',
  '/index.html',
  '/nouveau.html',
  '/historique.html',
  '/app.css',
  '/dashboard.js',
  '/nouveau.js',
  '/history.js',
  '/offline-store.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/app-icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-gcrs.png',
  '/logo-abeg.png',
  '/logo-arboreal.png',
  '/logo-dimensions.png',
  '/logo-esi.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    try { await cache.add('/api/bon-types'); } catch { /* sera mis en cache à la première ouverture */ }
    try { await cache.add('/api/config'); } catch { /* configuration serveur facultative hors ligne */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('gcrs-interventions-') && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, url.pathname));
    return;
  }
  if (/^\/api\/bons\/\d+\/pdf$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (['/api/bon-types', '/api/config', '/api/dashboard', '/api/bons'].some((path) => url.pathname === path)) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, navigationPath = '') {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (navigationPath) {
      const page = await caches.match(navigationPath === '/' ? '/' : navigationPath);
      if (page) return page;
      return caches.match('/');
    }
    return new Response(JSON.stringify({ error: 'Connexion indisponible.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag !== 'sync-gcrs-bons') return;
  event.waitUntil(syncPendingBons());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SYNC_GCRS_BONS') event.waitUntil(syncPendingBons());
});

async function syncPendingBons() {
  const result = await OfflineStore.syncAll();
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach((client) => client.postMessage({ type: 'GCRS_SYNC_COMPLETE', result }));
}
