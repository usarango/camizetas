// The same, deliberately small design vocabulary is used by the editor and the store.
const SECTION_DEFAULTS = [
  {id: 'hero', visible: true},
  {id: 'products', visible: true},
  {id: 'about', visible: false},
];

export const SAFE_ASSET_PATHS = Object.freeze([
  'assets/theme-chic.jpg', 'assets/theme-underground.jpg', 'assets/theme-rock.jpg',
  'assets/theme-nerd.jpg', 'assets/tee.jpg', 'assets/hoodie.jpg', 'assets/bag.jpg',
  'assets/fashion.jpg', 'assets/hero.jpg', 'assets/studio-model-1.jpg',
  'assets/studio-model-2.jpg', 'assets/studio-model-3.jpg', 'assets/product-placeholder.svg',
]);
const safeAssets = new Set(SAFE_ASSET_PATHS);

const base = {
  font: 'modern', hero: 'split', accent: '#5838d4', background: '#f7f5ef',
  heroImage: '', logoUrl: '', announcement: '', announcementEnabled: false,
  buttonLabel: 'Explorar coleção', gridColumns: 3, cardStyle: 'clean', radius: 0,
};

export const PRESETS = Object.freeze([
  {
    id: 'chic', label: 'Atelier', description: 'Editorial de moda, serifas elegantes e espaço para respirar.',
    legacyTemplate: 'chic', demoName: 'Atelier Forma', demoHeadline: 'O essencial,\nem outra forma.',
    defaults: {...base, font: 'editorial', hero: 'split', accent: '#344b43', background: '#f4f1e9', heroImage: 'assets/theme-chic.jpg', gridColumns: 3},
  },
  {
    id: 'underground', label: 'Subsolo', description: 'Tipografia crua, contraste alto e atitude de rua.',
    legacyTemplate: 'underground', demoName: 'SUBSOLO', demoHeadline: 'A rua não\npede licença.',
    defaults: {...base, font: 'bold', hero: 'split', accent: '#d4f148', background: '#171916', heroImage: 'assets/theme-underground.jpg', cardStyle: 'outlined', gridColumns: 3},
  },
  {
    id: 'rock', label: 'Amplify', description: 'Imagem de impacto, letras grandes e energia de palco.',
    legacyTemplate: 'rock', demoName: 'AMPLIFY', demoHeadline: 'Vista o que\nte move.',
    defaults: {...base, font: 'bold', hero: 'fullbleed', accent: '#e86547', background: '#191716', heroImage: 'assets/theme-rock.jpg', cardStyle: 'clean', gridColumns: 3},
  },
  {
    id: 'nerd', label: 'Pixel Club', description: 'Clima digital, detalhes de interface e identidade de comunidade.',
    legacyTemplate: 'nerd', demoName: 'PIXEL CLUB', demoHeadline: 'Seu próximo\nuniverso.',
    defaults: {...base, font: 'mono', hero: 'split', accent: '#af9dff', background: '#171b2a', heroImage: 'assets/theme-nerd.jpg', cardStyle: 'outlined', radius: 8, gridColumns: 4},
  },
  {
    id: 'minimal', label: 'Essência', description: 'Grade precisa, foco nas peças e estética de galeria.',
    legacyTemplate: 'chic', demoName: 'essência', demoHeadline: 'Menos ruído.\nMais você.',
    defaults: {...base, font: 'modern', hero: 'compact', accent: '#20211e', background: '#fafaf7', heroImage: '', cardStyle: 'clean', gridColumns: 4},
  },
  {
    id: 'botanical', label: 'Botânica', description: 'Tons naturais, formas orgânicas e um ritmo mais leve.',
    legacyTemplate: 'chic', demoName: 'botânica', demoHeadline: 'Feita para\nflorescer com você.',
    defaults: {...base, font: 'editorial', hero: 'split', accent: '#52694a', background: '#f1eee2', heroImage: 'assets/fashion.jpg', cardStyle: 'soft', radius: 20, gridColumns: 3},
  },
  {
    id: 'sport', label: 'Movimento', description: 'Composição dinâmica, linguagem atlética e cor em ação.',
    legacyTemplate: 'underground', demoName: 'MOVIMENTO', demoHeadline: 'Seu ritmo.\nSua próxima direção.',
    defaults: {...base, font: 'bold', hero: 'split', accent: '#c6f34a', background: '#f1f3ee', heroImage: 'assets/hero.jpg', cardStyle: 'clean', radius: 8, gridColumns: 3},
  },
  {
    id: 'pop', label: 'Pop', description: 'Cores abertas, formas gráficas e personalidade sem timidez.',
    legacyTemplate: 'nerd', demoName: 'oi, pop!', demoHeadline: 'Seu dia pede\num pouco de cor.',
    defaults: {...base, font: 'modern', hero: 'centered', accent: '#f489ad', background: '#fff5cf', heroImage: 'assets/tee.jpg', cardStyle: 'outlined', radius: 20, gridColumns: 3},
  },
].map(preset => Object.freeze({...preset, defaults: Object.freeze(preset.defaults)})));

const presetById = new Map(PRESETS.map(preset => [preset.id, preset]));
const enumValue = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** Text is stored as plain text; escaping belongs at the rendering boundary. */
export function designText(value, max = 160, fallback = '') {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : fallback;
}

export function safeImageURL(value, fallback = '') {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  const candidate = value.trim();
  if (safeAssets.has(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return url.href;
  } catch { /* Only absolute HTTPS URLs or known local assets are accepted. */ }
  return fallback;
}

export function designColor(value, fallback) {
  return typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

/** Black or white, whichever has the higher WCAG contrast against the color. */
export function contrastColor(color) {
  const hex = designColor(color, '#ffffff');
  const [r, g, b] = hex.slice(1).match(/../g).map(channel => {
    const n = parseInt(channel, 16) / 255;
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
  });
  return r * .2126 + g * .7152 + b * .0722 > .179 ? '#000000' : '#ffffff';
}

export function createDesign(presetId = 'chic') {
  const preset = presetById.get(presetId) || PRESETS[0];
  return {version: 1, preset: preset.id, ...preset.defaults, sections: SECTION_DEFAULTS.map(section => ({...section}))};
}

/** Ignore unknown fields, including CSS/HTML, and make legacy stores editable. */
export function normalizeDesign(raw, store = {}) {
  const source = isObject(raw) ? raw : {};
  const legacyStore = isObject(store) ? store : {};
  const presetId = presetById.has(source.preset) ? source.preset : presetById.has(legacyStore.template) ? legacyStore.template : 'chic';
  const defaults = createDesign(presetId);
  const normalized = {
    version: 1,
    preset: presetId,
    font: enumValue(source.font, ['editorial', 'modern', 'mono', 'bold'], defaults.font),
    hero: enumValue(source.hero, ['split', 'centered', 'fullbleed', 'compact'], defaults.hero),
    accent: designColor(source.accent, designColor(legacyStore.accent, defaults.accent)),
    background: designColor(source.background, designColor(legacyStore.background, defaults.background)),
    heroImage: hasOwn(source, 'heroImage') ? safeImageURL(source.heroImage) : defaults.heroImage,
    logoUrl: safeImageURL(source.logoUrl),
    announcement: designText(source.announcement, 160),
    announcementEnabled: source.announcementEnabled === true,
    buttonLabel: designText(source.buttonLabel, 48) || defaults.buttonLabel,
    gridColumns: enumValue(source.gridColumns, [2, 3, 4], defaults.gridColumns),
    cardStyle: enumValue(source.cardStyle, ['clean', 'outlined', 'soft'], defaults.cardStyle),
    radius: enumValue(source.radius, [0, 8, 20], defaults.radius),
    sections: [],
  };
  const sectionIds = new Set();
  if (Array.isArray(source.sections)) {
    for (const section of source.sections.slice(0, 12)) {
      if (!isObject(section) || !SECTION_DEFAULTS.some(known => known.id === section.id) || sectionIds.has(section.id)) continue;
      sectionIds.add(section.id);
      normalized.sections.push({id: section.id, visible: section.id === 'products' || (typeof section.visible === 'boolean' ? section.visible : SECTION_DEFAULTS.find(known => known.id === section.id).visible)});
    }
  }
  for (const section of SECTION_DEFAULTS) {
    if (!sectionIds.has(section.id)) normalized.sections.push({...section});
  }
  return normalized;
}

export function resolveDesign(store = {}) {
  return normalizeDesign(store?.design, store);
}

export function designToStorePatch(design, brand = {}) {
  const normalized = normalizeDesign(design, brand);
  const source = isObject(brand) ? brand : {};
  const name = designText(source.name, 80);
  return {
    name,
    headline: designText(source.headline, 100),
    description: designText(source.description, 3000),
    template: presetById.get(normalized.preset).legacyTemplate,
    accent: normalized.accent,
    background: normalized.background,
    design: normalized,
  };
}
