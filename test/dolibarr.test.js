const test = require('node:test');
const assert = require('node:assert/strict');
const { DolibarrClient, durationSeconds, dolibarrLine, buildDolibarrFlow } = require('../lib/dolibarr');

test('calcule une durée explicite', () => {
  assert.equal(durationSeconds({ temps_passe: '02h30' }), 9000);
});

test('calcule une durée depuis les horaires', () => {
  assert.equal(durationSeconds({ heures_d_arrivee: '08:15', heure_depart: '10:00' }), 6300);
});

test('construit une ligne Dolibarr HT', () => {
  const line = dolibarrLine({ code: 'P-1', designation: 'Filtre', unit_price: 12.5, quantity: 2, vat_rate: 20 }, 20, 0);
  assert.equal(line.desc, '[P-1] Filtre');
  assert.equal(line.subprice, 12.5);
  assert.equal(line.qty, 2);
  assert.equal(line.product_type, 0);
});

test('détecte explicitement un module API Dolibarr désactivé', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => new Response('Le module Api doit être activé pour utiliser cette fonction.', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  try {
    const client = new DolibarrClient({ baseUrl: 'https://dolibarr.example', apiKey: 'test' });
    await assert.rejects(() => client.request('GET', 'thirdparties?limit=1'), /module API REST doit être activé/);
  } finally {
    global.fetch = previousFetch;
  }
});

test('enchaîne intervention, commande et facture brouillon', async () => {
  let nextId = 100;
  const calls = [];
  const client = {
    vatRate: 20,
    searchThirdparties: async () => [{ id: 12, name: 'Client test' }],
    request: async (method, resource, body) => {
      calls.push({ method, resource, body });
      if (method === 'GET' && resource.startsWith('interventions/')) return { id: 101, ref: 'FI2608-0001' };
      if (resource.startsWith('invoices/createfromorder/')) return { id: 103 };
      return nextId++;
    },
  };
  const bon = {
    public_ref: 'BI-2026-00001', client: 'Client test', date_et_heure1: '2026-08-16T09:00',
    bon_de: 'Dépannage', travail_effectue: 'Remplacement filtre', temps_passe: '01h00',
    items: [{ code: 'P-1', designation: 'Filtre', unit_price: 12.5, quantity: 1, vat_rate: 20 }],
  };
  const result = await buildDolibarrFlow({ client, bon, pdfPath: null });
  assert.equal(result.thirdparty, 12);
  assert.equal(result.intervention, 100);
  assert.equal(result.order, 102);
  assert.equal(result.invoice, 103);
  assert.ok(calls.some((call) => call.resource === 'interventions'));
  assert.ok(calls.some((call) => call.resource === 'orders/102/lines'));
  assert.ok(calls.some((call) => call.resource === 'invoices/createfromorder/102'));
});
