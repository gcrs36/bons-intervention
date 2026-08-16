const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('déclare une application installable avec ses raccourcis', () => {
  const manifest = JSON.parse(read('public', 'manifest.webmanifest'));
  assert.equal(manifest.name, 'GCRS Interventions');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((icon) => icon.sizes === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert.ok(fs.statSync(path.join(root, 'public', 'icon-192.png')).size > 1000);
  assert.ok(fs.statSync(path.join(root, 'public', 'icon-512.png')).size > 5000);
  assert.deepEqual(manifest.shortcuts.map((shortcut) => shortcut.url), ['/nouveau.html', '/historique.html']);
});

test('prépare les trois écrans principaux pour le fonctionnement hors ligne', () => {
  for (const filename of ['index.html', 'nouveau.html', 'historique.html']) {
    const html = read('public', filename);
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(html, /src="\/offline-store\.js"/);
    assert.match(html, /src="\/pwa\.js"/);
  }
});

test('met en cache l’application et rejoue la file d’attente', () => {
  const worker = read('public', 'sw.js');
  const store = read('public', 'offline-store.js');
  assert.match(worker, /APP_SHELL/);
  assert.match(worker, /sync-gcrs-bons/);
  assert.match(store, /indexedDB\.open/);
  assert.match(store, /client_request_id/);
  assert.match(store, /syncAll/);
});

test('protège le serveur contre un double envoi après reconnexion', () => {
  const server = read('server.js');
  assert.match(server, /idx_bons_client_request_id/);
  assert.match(server, /respondWithExistingRequest/);
});

test('arrondit l’heure automatique au pas de cinq minutes', () => {
  const form = read('public', 'nouveau.js');
  assert.match(form, /Math\.floor\(rounded\.getMinutes\(\) \/ 5\) \* 5/);
});
