const DEFAULT_PROFESSIONS = require('../constants/professions');
const ProfessionCatalog = require('../models/ProfessionCatalog');
const { PROFESSION_RULES } = require('../utils/professionInferenceUtils');

const uniqueStrings = (values = []) => {
  const seen = new Set();
  const items = [];

  values.forEach((value) => {
    const cleaned = String(value || '').trim();
    const normalized = cleaned
      .toLowerCase()
      .replace(/[^\p{L}\p{N}+/&\s-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned || !normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    items.push(cleaned);
  });

  return items;
};

const normalizeProfessionKey = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N}+/&\s-]+/gu, ' ')
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
  buildDefaultProfessionMap() {
    const entries = new Map();

    DEFAULT_PROFESSIONS.forEach((profession) => {
      const normalizedName = normalizeProfessionKey(profession);
      entries.set(normalizedName, {
        name: profession,
        normalizedName,
        source: 'system',
        aliases: [],
        tags: []
      });
    });

    PROFESSION_RULES.forEach((rule) => {
      const normalizedName = normalizeProfessionKey(rule.profession);
      const existing = entries.get(normalizedName) || {
        name: formatProfessionName(rule.profession),
        normalizedName,
        source: 'system',
        aliases: [],
        tags: []
      };

      const aliases = uniqueStrings([
        ...existing.aliases,
        ...(rule.keywords || []).filter((keyword) => normalizeProfessionKey(keyword) !== normalizedName)
      ]);
      const tags = uniqueStrings([
        ...existing.tags,
        ...(rule.specializations || []),
        ...(rule.keywords || []).filter((keyword) => String(keyword || '').trim().split(/\s+/).length <= 4)
      ]);

      entries.set(normalizedName, {
        ...existing,
        aliases,
        tags
      });
    });

    return entries;
  }

  normalizeProfessionKey(value = '') {
    return normalizeProfessionKey(value);
  }

  formatProfessionName(value = '') {
    return formatProfessionName(value);
  }

  getSearchTerms(entry = {}) {
    return uniqueStrings([
      entry.name,
      ...(entry.aliases || []),
      ...(entry.tags || [])
    ]);
  }

  scoreProfessionMatch(candidate = '', entry = {}) {
    const normalizedCandidate = normalizeProfessionKey(candidate);
    if (!normalizedCandidate) {
      return 0;
    }

    const normalizedName = normalizeProfessionKey(entry.name);
    const normalizedAliases = (entry.aliases || []).map((item) => normalizeProfessionKey(item)).filter(Boolean);
    const normalizedTags = (entry.tags || []).map((item) => normalizeProfessionKey(item)).filter(Boolean);
    const exactAliases = new Set(normalizedAliases);
    const exactTags = new Set(normalizedTags);

    if (normalizedCandidate === normalizedName) {
      return 140;
    }

    if (exactAliases.has(normalizedCandidate)) {
      return 125;
    }

    if (exactTags.has(normalizedCandidate)) {
      return 118;
    }

    let bestScore = 0;
    const scoreTerm = (term = '', baseScore = 0) => {
      if (!term) {
        return;
      }

      if (term.includes(normalizedCandidate) || normalizedCandidate.includes(term)) {
        bestScore = Math.max(bestScore, baseScore);
        return;
      }

      const candidateTokens = normalizedCandidate.split(/\s+/).filter(Boolean);
      const termTokens = term.split(/\s+/).filter(Boolean);
      const overlap = candidateTokens.filter((token) => termTokens.some((item) => item.includes(token) || token.includes(item)));
      if (overlap.length > 0) {
        bestScore = Math.max(bestScore, Math.min(baseScore - 4, overlap.length * 10));
      }
    };

    scoreTerm(normalizedName, 104);
    normalizedAliases.forEach((alias) => scoreTerm(alias, 94));
    normalizedTags.forEach((tag) => scoreTerm(tag, 84));

    return bestScore;
  }

  findBestProfessionMatchSync(candidate = '', entries = []) {
    let bestEntry = null;
    let bestScore = 0;

    entries.forEach((entry) => {
      const score = this.scoreProfessionMatch(candidate, entry);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    });

    return bestScore >= 18 ? bestEntry : null;
  }

  findProfessionMatchesInTextSync(text = '', entries = [], limit = 3) {
    const normalizedText = normalizeProfessionKey(text);
    if (!normalizedText) {
      return [];
    }

    return entries
      .map((entry) => {
        const searchTerms = this.getSearchTerms(entry)
          .map((term) => normalizeProfessionKey(term))
          .filter(Boolean);

        const score = searchTerms.reduce((best, term) => {
          if (!term) {
            return best;
          }

          if (normalizedText === term) {
            return Math.max(best, 140);
          }

          if (normalizedText.includes(term)) {
            return Math.max(best, Math.min(118, 60 + term.split(/\s+/).length * 16));
          }

          const tokens = term.split(/\s+/).filter(Boolean);
          const overlap = tokens.filter((token) => normalizedText.includes(token));
          if (overlap.length > 0) {
            return Math.max(best, overlap.length * 14);
          }

          return best;
        }, 0);

        return { entry, score };
      })
      .filter((item) => item.score >= 18)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((item) => item.entry);
  }

  mergeProfessionEntries(baseEntry = {}, extraEntry = {}) {
    return {
      name: extraEntry.name || baseEntry.name || '',
      normalizedName: extraEntry.normalizedName || baseEntry.normalizedName || '',
      source: extraEntry.source || baseEntry.source || 'system',
      aliases: uniqueStrings([...(baseEntry.aliases || []), ...(extraEntry.aliases || [])]),
      tags: uniqueStrings([...(baseEntry.tags || []), ...(extraEntry.tags || [])])
    };
  }

  async getAllProfessionEntries() {
    const defaultMap = this.buildDefaultProfessionMap();
    const stored = await ProfessionCatalog.find({})
      .sort({ name: 1 })
      .lean();

    stored.forEach((item) => {
      const normalizedName = normalizeProfessionKey(item.normalizedName || item.name);
      const existing = defaultMap.get(normalizedName) || {
        name: item.name,
        normalizedName,
        source: item.source || 'ai',
        aliases: [],
        tags: []
      };

      defaultMap.set(normalizedName, this.mergeProfessionEntries(existing, {
        name: item.name || existing.name,
        normalizedName,
        source: item.source || existing.source,
        aliases: item.aliases || [],
        tags: item.tags || []
      }));
    });

    return [...defaultMap.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async getAllProfessions() {
    const entries = await this.getAllProfessionEntries();

    return uniqueStrings(entries.map((item) => item.name))
      .sort((left, right) => left.localeCompare(right));
  }

  async findBestProfessionMatch(candidate = '') {
    const entries = await this.getAllProfessionEntries();
    return this.findBestProfessionMatchSync(candidate, entries);
  }

  async ensureProfession(value = '', options = {}) {
    const aliases = uniqueStrings(options.aliases || []);
    const tags = uniqueStrings(options.tags || []);
    const entries = await this.getAllProfessionEntries();
    const matchedEntry = this.findBestProfessionMatchSync(value, entries)
      || aliases.map((alias) => this.findBestProfessionMatchSync(alias, entries)).find(Boolean)
      || tags.map((tag) => this.findBestProfessionMatchSync(tag, entries)).find(Boolean);

    const formatted = matchedEntry?.name || formatProfessionName(value);
    const normalizedName = matchedEntry?.normalizedName || normalizeProfessionKey(formatted);
    if (!formatted || !normalizedName) {
      return '';
    }

    const existingDefault = this.buildDefaultProfessionMap().get(normalizedName);
    const finalName = existingDefault?.name || formatted;

    await ProfessionCatalog.findOneAndUpdate(
      { normalizedName },
      {
        $setOnInsert: {
          name: finalName,
          normalizedName,
          source: options.source || matchedEntry?.source || (existingDefault ? 'system' : 'ai')
        },
        $addToSet: {
          aliases: {
            $each: uniqueStrings([
              ...(matchedEntry?.aliases || []),
              ...aliases
            ])
          },
          tags: {
            $each: uniqueStrings([
              ...(matchedEntry?.tags || []),
              ...tags
            ])
          }
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return finalName;
  }
}

module.exports = new ProfessionCatalogService();
