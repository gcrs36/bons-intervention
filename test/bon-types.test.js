const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BON_TYPES, MASSICOT_CHECKLIST, getBonType, publicBonTypes } = require('../lib/bon-types');
const { generateGenericPdf } = require('../lib/pdf-generic');

test('expose les quatre familles de documents migrées depuis Kizeo', () => {
  assert.deepEqual(Object.keys(BON_TYPES), ['intervention', 'visite_massicot', 'mise_en_service', 'fiche_machine']);
  assert.deepEqual(BON_TYPES.intervention.variants, ['gcrs', 'abeg', 'arboreal', 'dimensions', 'esi']);
  assert.equal(Object.keys(publicBonTypes().variants).length, 5);
});

test('reprend la checklist massicot complète de A1 à D38', () => {
  assert.equal(MASSICOT_CHECKLIST.length, 42);
  assert.equal(MASSICOT_CHECKLIST[0].code, 'A1');
  assert.equal(MASSICOT_CHECKLIST.at(-1).code, 'D38');
});

test('refuse une variante qui ne correspond pas à la famille', () => {
  assert.equal(getBonType('visite_massicot', 'dimensions'), null);
  assert.equal(getBonType('mise_en_service', 'gcrs').prefix, 'MES');
});

test('génère un PDF professionnel pour une nouvelle famille', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gcrs-pdf-'));
  const output = path.join(directory, 'mise-en-service.pdf');
  try {
    await generateGenericPdf({
      public_ref: 'MES-2026-00001', bon_type: 'mise_en_service', bon_variant: 'gcrs',
      date_et_heure1: '2026-08-16T09:00', client: 'Client test', type_materiel_: 'Machine test',
      n_de_matricule_: 'SN-1', travail_effectue: 'Mise en service réalisée', non_du_technicien: 'Formateur',
      nom_du_signataire_: 'Client', items: [], extra: { fields: { observations: 'Essais concluants.' } },
    }, output);
    const bytes = fs.readFileSync(output);
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    assert.ok(bytes.length > 3000);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
