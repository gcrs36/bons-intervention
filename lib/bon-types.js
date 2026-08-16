const VARIANTS = {
  gcrs: { id: 'gcrs', label: 'GCRS', color: '#173b57' },
  abeg: { id: 'abeg', label: 'ABEG', color: '#1b5b8c' },
  arboreal: { id: 'arboreal', label: 'ARBOREAL', color: '#43845b' },
  dimensions: { id: 'dimensions', label: 'Dimensions', color: '#9b1b30' },
  esi: { id: 'esi', label: 'ESI', color: '#5553a6' },
};

const MASSICOT_CHECKLIST = [
  { group: 'A', groupLabel: 'Vérification visuelle', code: 'A1', label: 'Stabilité' },
  { group: 'A', code: 'A2', label: 'Fixation des boutons de la double commande' },
  { group: 'A', code: 'A3a', label: 'Fixation du barrage immatériel' },
  { group: 'A', code: 'A3b', label: 'Fixation du carter de protection amovible' },
  { group: 'A', code: 'A4', label: 'Fixation du cache pédale' },
  { group: 'A', code: 'A5', label: 'Fixation de la protection arrière (tunnel)' },
  { group: 'A', code: 'A6', label: 'Fixation des carters des éléments de transmission' },
  { group: 'A', code: 'A7', label: 'Protection par éloignement ou obstacle (tables, cloisons, etc.)' },
  { group: 'A', code: 'A8', label: 'Autre élément de protection' },
  { group: 'A', code: 'A9', label: 'État visible des matériaux' },
  { group: 'A', code: 'A10', label: 'État de propreté' },
  { group: 'A', code: 'A11', label: 'État des filtres et des échappements' },
  { group: 'A', code: 'A12', label: 'État visible des liaisons et raccordements' },
  { group: 'B', groupLabel: 'Essais de fonctionnement', code: 'B13', label: 'Boutons de la double commande : synchronisme' },
  { group: 'B', code: 'B14a', label: 'Présence et fonctionnement du barrage immatériel' },
  { group: 'B', code: 'B14b', label: 'Présence et fonctionnement du carter amovible' },
  { group: 'B', code: 'B15', label: 'Commande sensitive au pied' },
  { group: 'B', code: 'B16', label: 'Pression réduite' },
  { group: 'B', code: 'B17', label: 'Protection arrière (tunnel)' },
  { group: 'B', code: 'B18', label: 'Carters des éléments de transmission' },
  { group: 'B', code: 'B19', label: 'Protection par éloignement ou obstacle' },
  { group: 'B', code: 'B20', label: 'Autre dispositif de protection' },
  { group: 'B', code: 'B21', label: 'Caractéristiques anormales de fonctionnement' },
  { group: 'B', code: 'B22', label: 'Arrêt par la double commande' },
  { group: 'B', code: 'B23a', label: 'Arrêt par le barrage immatériel' },
  { group: 'B', code: 'B23b', label: 'Arrêt par le carter amovible' },
  { group: 'B', code: 'B24', label: "Arrêt d’urgence" },
  { group: 'B', code: 'B25', label: 'Sélecteur de mode de marche' },
  { group: 'B', code: 'B26', label: 'Non-répétition du cycle avec maintien de la double commande' },
  { group: 'B', code: 'B27', label: 'Autre dispositif d’arrêt volontaire' },
  { group: 'B', code: 'B28', label: 'Arrêt au soulèvement des capots asservis' },
  { group: 'B', code: 'B29', label: "Arrêt par les poussoirs d’arrêt" },
  { group: 'B', code: 'B30', label: 'Autre arrêt associé à une protection' },
  { group: 'C', groupLabel: 'Réglages et jeux', code: 'C31', label: 'Niveau des fluides' },
  { group: 'C', code: 'C32a', label: "Pression d’air" },
  { group: 'C', code: 'C32b', label: "Pression d’huile" },
  { group: 'C', code: 'C33', label: 'État visible des ressorts' },
  { group: 'C', code: 'C34', label: 'Jeux anormaux visibles' },
  { group: 'C', code: 'C35', label: "État visible des pièces d’usure" },
  { group: 'C', code: 'C36', label: 'Réglage des fins de course et position haute de la lame' },
  { group: 'D', groupLabel: 'État des indicateurs', code: 'D37', label: 'Appareils de mesure et manomètres' },
  { group: 'D', code: 'D38', label: 'Dispositifs de signalisation' },
];

const BON_TYPES = {
  intervention: {
    id: 'intervention', label: "Bon d’intervention", shortLabel: 'Intervention', prefix: 'BI',
    description: 'Dépannage, entretien, installation ou formation avec pièces, temps et frais.',
    variants: ['gcrs', 'abeg', 'arboreal', 'dimensions', 'esi'], syncDefault: true,
  },
  visite_massicot: {
    id: 'visite_massicot', label: 'Visite trimestrielle massicot', shortLabel: 'Visite massicot', prefix: 'VT',
    description: 'Contrôle réglementaire complet A1 à D38, changement de lame et conformité.',
    variants: ['gcrs', 'abeg', 'arboreal', 'esi'], syncDefault: true, checklist: MASSICOT_CHECKLIST,
  },
  mise_en_service: {
    id: 'mise_en_service', label: 'Procès-verbal de mise en service', shortLabel: 'Mise en service', prefix: 'MES',
    description: 'Installation, numéros de série, formation et signatures client/formateur.',
    variants: ['gcrs'], syncDefault: true,
  },
  fiche_machine: {
    id: 'fiche_machine', label: 'Fiche machine atelier', shortLabel: 'Fiche machine', prefix: 'FM',
    description: 'Réception atelier, diagnostic, actions, issue, devis et mise au rebut.',
    variants: ['gcrs'], syncDefault: false,
  },
};

function publicBonTypes() {
  return {
    variants: VARIANTS,
    types: BON_TYPES,
    checklistStates: ['Bon', 'Mauvais', 'Inexistant', 'Non applicable'],
  };
}

function getBonType(type, variant) {
  const definition = BON_TYPES[String(type || '')];
  if (!definition) return null;
  const selectedVariant = String(variant || definition.variants[0]);
  if (!definition.variants.includes(selectedVariant)) return null;
  return { ...definition, variant: VARIANTS[selectedVariant] };
}

module.exports = { BON_TYPES, VARIANTS, MASSICOT_CHECKLIST, publicBonTypes, getBonType };
