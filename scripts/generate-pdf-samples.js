const fs = require('node:fs');
const path = require('node:path');
const { generateGenericPdf } = require('../lib/pdf-generic');
const { MASSICOT_CHECKLIST } = require('../lib/bon-types');

const outputDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'tmp-pdf-samples'));
fs.mkdirSync(outputDir, { recursive: true });

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const base = {
  date_et_heure1: '2026-08-16T09:05', client: 'Imprimerie Exemple', tel_: '04 00 00 00 00',
  mail: 'atelier@example.fr', adresse: '12 rue des Ateliers\n69000 Lyon', ref_cde_client: 'CMD-2026-148',
  type_materiel_: 'Massicot hydraulique 115', n_de_matricule_: 'SN-2026-0042', non_du_technicien: 'Jean Technicien',
  nom_du_signataire_: 'Marie Responsable', signature: pixel, items: [],
  heures_d_arrivee: '09:05', heure_depart: '12:40', temps_passe: '03h35', km: 48, repas: 1, hotel: 0, autoroute: 12.4,
};

const samples = [
  {
    ...base, public_ref: 'BI-2026-TEST1', bon_type: 'kizeo_979461', bon_variant: 'esi', bon_de: 'Dépannage',
    travail_effectue: "Diagnostic complet de la commande, remplacement des composants défectueux, réglage des sécurités et essais en production. Le fonctionnement a été validé avec l’opérateur.",
    items: [
      { code: 'CAP-24V', designation: 'Capteur inductif 24 V avec connecteur et câble de raccordement', unit_price: 89.5, quantity: 2, line_total: 179 },
      { code: 'REL-01', designation: 'Relais de sécurité', unit_price: 142, quantity: 1, line_total: 142 },
    ],
    extra: { fields: { panne_signalee_: 'Arrêts aléatoires pendant le cycle.', types_d_intervention: 'Curatif', intervention_a_suivre: '1', validation_fonctionnement: '1', rapport_d_intervention: "Diagnostic complet, remplacement des composants défectueux et validation avec l’opérateur." }, signature_technicien: pixel,
      days: Array.from({ length: 5 }, (_, index) => ({ date: `2026-08-${String(16 + index).padStart(2, '0')}`, on_site: '07h30', trips: '1', outbound: '01h10', return: '01h05', km: '48', tolls: '12.40', meals: '1', hotel: index ? '1' : '0', report: `Rapport détaillé du jour ${index + 1} : contrôles, mesures, réglages et essais de validation avec l’équipe de production.` })),
      photos: [],
    },
  },
  {
    ...base, public_ref: 'VT-2026-TEST2', bon_type: 'kizeo_837666', bon_variant: 'gcrs', bon_de: 'Visite massicot',
    travail_effectue: 'Visite trimestrielle massicot — 42 points contrôlés. Conclusion : Conforme avec réserves.',
    extra: { fields: { trimestre: '3e trimestre', numero_identification: 'MASS-42', marque: 'Polar', type_machine: '115 XT', changement_lame: 'Oui', taille_lame: '1 390 × 160 × 13,75 mm', etat_lame: 'Moyen', usure_lame: 'Normale', conformite: 'Conforme avec réserves', non_conformite: 'Remplacer le capot fissuré avant la prochaine visite.', fournitures: 'Graisse et produit de nettoyage.', divers: 'Essai opérateur concluant.' }, signature_technicien: pixel,
      checklist: MASSICOT_CHECKLIST.map((item, index) => ({ ...item, state: index === 8 ? 'Mauvais' : 'Bon', comment: index === 8 ? 'Carter fissuré, remplacement recommandé.' : '' })), photos: [],
    },
  },
  {
    ...base, public_ref: 'MES-2026-TEST3', bon_type: 'kizeo_719210', bon_variant: 'gcrs', bon_de: 'Mise en service',
    travail_effectue: 'Mise en service effectuée et formation réalisée.',
    extra: { fields: { contact: 'Marie Responsable', supports_formation: 'Manuel utilisateur, fiche sécurité', liste_formation: 'Conduite, réglages, entretien de premier niveau', numeros_serie: 'Machine : SN-2026-0042\nAccessoire : ACC-178', observations: 'Installation conforme. Tests de production réalisés avec le client.', presences_formation: 'Marie Responsable\nPaul Opérateur\nLucie Opératrice' }, signature_technicien: pixel, photos: [] },
  },
  {
    ...base, public_ref: 'FM-2026-TEST4', bon_type: 'kizeo_738193', bon_variant: 'gcrs', bon_de: 'Fiche machine',
    travail_effectue: 'Machine réceptionnée pour diagnostic électrique.', signature: '', nom_du_signataire_: '',
    extra: { fields: { provenance: 'Retour client', but: 'Diagnostic', compteur: '245 800', issue: 'À suivre', devis: 'À faire', mise_au_rebut: 'Non', observation: 'La machine déclenche à la mise sous tension.', action_realisee: 'Contrôle visuel, mesures d’isolement et identification du moteur défectueux.' }, signature_technicien: pixel, photos: [] },
  },
  {
    ...base, public_ref: 'ARB-2026-TEST5', bon_type: 'kizeo_835991', bon_variant: 'arboreal', bon_de: 'Dépannage',
    travail_effectue: 'Diagnostic, réglage et essais de fonctionnement avec le client.',
    extra: { fields: { bon_de: 'Dépannage', nombre_de_passage: '1', travail_effectue_: 'Diagnostic, réglage et essais de fonctionnement avec le client.' }, signature_technicien: pixel, photos: [] },
  },
];

const selectedReference = process.argv[3] || '';
const selectedSamples = selectedReference ? samples.filter((sample) => sample.public_ref === selectedReference) : samples;
if (!selectedSamples.length) throw new Error(`Échantillon inconnu : ${selectedReference}`);

Promise.all(selectedSamples.map((sample) => generateGenericPdf(sample, path.join(outputDir, `${sample.public_ref}.pdf`))))
  .then(() => process.stdout.write(`${selectedSamples.length} PDF généré(s) dans ${outputDir}\n`))
  .catch((error) => { console.error(error); process.exitCode = 1; });
