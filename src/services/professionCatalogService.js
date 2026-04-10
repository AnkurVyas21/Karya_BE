const DEFAULT_PROFESSIONS = require('../constants/professions');
const ProfessionCatalog = require('../models/ProfessionCatalog');

const uniqueStrings = (values = []) => [...new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)];

const normalizeProfessionKey = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9+/&\s-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const ACRONYM_TOKENS = new Map([
  ['ac', 'AC'],
  ['seo', 'SEO'],
  ['ui', 'UI'],
  ['ux', 'UX'],
  ['hr', 'HR'],
  ['qa', 'QA'],
  ['it', 'IT'],
  ['ai', 'AI']
]);

const formatProfessionName = (value = '') => {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\btech\b/gi, 'Technician');

  if (!cleaned) {
    return '';
  }

  return cleaned
    .split(' ')
    .map((part) => {
      const token = part.trim();
      if (!token) {
        return '';
      }

      const directAcronym = ACRONYM_TOKENS.get(token.toLowerCase());
      if (directAcronym) {
        return directAcronym;
      }

      if (token.includes('/')) {
        return token
          .split('/')
          .map((item) => formatProfessionName(item))
          .join('/');
      }

      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(' ')
    .trim();
};

class ProfessionCatalogService {
  normalizeProfessionKey(value = '') {
    return normalizeProfessionKey(value);
  }

  formatProfessionName(value = '') {
    return formatProfessionName(value);
  }

  async getAllProfessions() {
    const stored = await ProfessionCatalog.find({})
      .sort({ name: 1 })
      .select('name');

    return uniqueStrings([
      ...DEFAULT_PROFESSIONS,
      ...stored.map((item) => item.name)
    ]).sort((left, right) => left.localeCompare(right));
  }

  async ensureProfession(value = '', options = {}) {
    const formatted = formatProfessionName(value);
    const normalizedName = normalizeProfessionKey(formatted);
    if (!formatted || !normalizedName) {
      return '';
    }

    const aliases = uniqueStrings(options.aliases || []);
    const existingDefault = DEFAULT_PROFESSIONS.find((item) => normalizeProfessionKey(item) === normalizedName);
    const finalName = existingDefault || formatted;

    await ProfessionCatalog.findOneAndUpdate(
      { normalizedName },
      {
        $setOnInsert: {
          name: finalName,
          normalizedName,
          source: options.source || (existingDefault ? 'system' : 'ai')
        },
        $addToSet: {
          aliases: { $each: aliases }
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return finalName;
  }
}

module.exports = new ProfessionCatalogService();
