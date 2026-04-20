const DEFAULT_PROFESSIONS = require('../constants/professions');
const PROFESSION_SEED_DATA = require('../constants/professionSeedData');
const { PROFESSION_RELATIONS } = require('../constants/professionContextData');
const ProfessionCatalog = require('../models/ProfessionCatalog');
const embeddingService = require('./embeddingService');
const textNormalizationService = require('./textNormalizationService');

const DOMAIN_HINTS = {
  technology: ['developer', 'web', 'website', 'software', 'app', 'application', 'frontend', 'backend', 'devops', 'seo', 'digital', 'designer', 'ui', 'ux', 'data', 'computer', 'tech'],
  wedding: ['wedding', 'marriage', 'shaadi', 'shadi', 'baraat', 'barat', 'mehndi', 'mehendi', 'pandit', 'ghodi', 'safa', 'band', 'decor', 'decorator', 'tent', 'florist', 'bridal'],
  'home services': ['plumber', 'electrician', 'carpenter', 'mason', 'painter', 'cleaner', 'repair', 'house', 'home', 'bathroom', 'pipe', 'wiring', 'furniture'],
  medical: ['doctor', 'medical', 'homeopathy', 'homeopath', 'clinic', 'nurse', 'physician', 'treatment', 'vet', 'veterinarian', 'health'],
  food: ['caterer', 'halwai', 'cook', 'food', 'meal', 'kitchen', 'tiffin', 'chef', 'vendor', 'street food'],
  transport: ['driver', 'mover', 'transport', 'logistics', 'delivery', 'cargo', 'shift', 'shifting', 'vehicle', 'truck', 'tempo', 'gaadi', 'gadi']
};

const uniqueStrings = (values = []) => {
  const seen = new Set();
  const output = [];

  values.forEach((value) => {
    const cleaned = String(value || '').trim();
    const normalized = textNormalizationService.normalizeProfessionKey(cleaned);
    if (!cleaned || !normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    output.push(cleaned);
  });

  return output;
};

const PROFESSION_CACHE_TTL_MS = Math.max(Number(process.env.PROFESSION_CACHE_TTL_MS || 5 * 60 * 1000) || (5 * 60 * 1000), 1000);
const NEUTRAL_PROFESSION_TOKENS = new Set([
  'a', 'an', 'the', 'for', 'with', 'and', 'or', 'to', 'of', 'in', 'on', 'at',
  'need', 'looking', 'look', 'want', 'wanted', 'required', 'service', 'services',
  'provider', 'professional', 'expert', 'specialist', 'best', 'good', 'top',
  'local', 'nearby', 'near', 'online', 'freelance', 'freelancer'
]);

class ProfessionCatalogService {
  constructor() {
    this.catalogCache = {
      seeded: false,
      seedingPromise: null,
      entries: null,
      professions: null,
      expiresAt: 0
    };
  }

  async ensureSystemCatalog() {
    if (this.catalogCache.seeded) {
      return;
    }

    if (this.catalogCache.seedingPromise) {
      await this.catalogCache.seedingPromise;
      return;
    }

    this.catalogCache.seedingPromise = (async () => {
    const mergedByKey = new Map();
    const addSeed = (profession = {}) => {
      const canonicalName = this.formatProfessionName(profession.canonicalName || profession.name || profession);
      if (!canonicalName) {
        return;
      }

      const normalizedKey = this.normalizeProfessionKey(canonicalName);
      const existing = mergedByKey.get(normalizedKey) || {
        canonicalName,
        aliases: [],
        tags: [],
        relatedProfessions: []
      };

      mergedByKey.set(normalizedKey, {
        canonicalName,
        aliases: uniqueStrings([...(existing.aliases || []), ...(profession.aliases || [])]),
        tags: uniqueStrings([...(existing.tags || []), ...(profession.tags || [])]),
        relatedProfessions: uniqueStrings([...(existing.relatedProfessions || []), ...(profession.relatedProfessions || [])])
      });
    };

    DEFAULT_PROFESSIONS.forEach((profession) => addSeed({ canonicalName: profession }));
    PROFESSION_SEED_DATA.forEach((profession) => addSeed(profession));
    const seedData = [...mergedByKey.values()];

    for (const profession of seedData) {
      const canonicalName = this.formatProfessionName(profession.canonicalName || profession);
      const normalizedKey = this.normalizeProfessionKey(canonicalName);
      await ProfessionCatalog.updateOne(
        {
          $or: [
            { normalizedKey },
            { normalizedName: normalizedKey }
          ]
        },
        {
          $setOnInsert: {
            canonicalName,
            normalizedKey,
            normalizedName: normalizedKey,
            source: 'system'
          },
          $set: {
            relatedProfessions: uniqueStrings([
              ...(profession.relatedProfessions || []),
              ...(PROFESSION_RELATIONS[canonicalName] || [])
            ])
          },
          $addToSet: {
            aliases: {
              $each: uniqueStrings(profession.aliases || [])
            },
            tags: {
              $each: uniqueStrings(profession.tags || [])
            }
          }
        },
        { upsert: true }
      );
    }
      this.catalogCache.seeded = true;
    })();

    try {
      await this.catalogCache.seedingPromise;
    } finally {
      this.catalogCache.seedingPromise = null;
    }
  }

  sanitizeEntryTags(entry = {}) {
    const canonicalName = entry.canonicalName || entry.name || '';
    const aliases = uniqueStrings(entry.aliases || []);
    const referenceTerms = [canonicalName, ...aliases];

    return uniqueStrings(entry.tags || []).filter((tag) => {
      const score = Math.max(
        ...referenceTerms.map((term) => this.stringSimilarity(tag, term)),
        this.stringSimilarity(tag, canonicalName),
        0
      );
      return score >= 0.18;
    }).slice(0, 8);
  }

  normalizeProfessionKey(value = '') {
    return textNormalizationService.normalizeProfessionKey(value);
  }

  formatProfessionName(value = '') {
    return textNormalizationService.formatProfessionName(value);
  }

  buildEmbeddingText(entry = {}) {
    const canonicalName = entry.canonicalName || entry.name || '';
    const aliases = uniqueStrings(entry.aliases || []);
    const tags = uniqueStrings(entry.tags || []);
    const variants = [
      canonicalName,
      ...textNormalizationService.buildVariants(canonicalName),
      ...aliases.flatMap((item) => [item, ...textNormalizationService.buildVariants(item)]),
      ...tags
    ];

    return uniqueStrings(variants).join(' | ');
  }

  toEntry(doc = {}) {
    const canonicalName = String(doc.canonicalName || doc.name || '').trim();
    const normalizedKey = this.normalizeProfessionKey(doc.normalizedKey || doc.normalizedName || canonicalName);
    return {
      id: doc._id?.toString?.() || '',
      name: canonicalName,
      canonicalName,
      normalizedKey,
      aliases: uniqueStrings(doc.aliases || []),
      tags: this.sanitizeEntryTags({
        canonicalName,
        aliases: doc.aliases || [],
        tags: doc.tags || []
      }),
      relatedProfessions: uniqueStrings(doc.relatedProfessions || PROFESSION_RELATIONS[canonicalName] || []),
      source: doc.source || 'learned',
      embedding: doc.embedding || {},
      learning: doc.learning || {}
    };
  }

  async getAllProfessionEntries() {
    await this.ensureSystemCatalog();
    if (this.catalogCache.entries && this.catalogCache.expiresAt > Date.now()) {
      return this.catalogCache.entries;
    }

    const rows = await ProfessionCatalog.find({})
      .sort({ canonicalName: 1, name: 1 })
      .lean();

    const entries = rows
      .map((row) => this.toEntry(row))
      .filter((entry) => entry.canonicalName);
    this.catalogCache.entries = entries;
    this.catalogCache.professions = null;
    this.catalogCache.expiresAt = Date.now() + PROFESSION_CACHE_TTL_MS;
    return entries;
  }

  async getAllProfessions() {
    if (this.catalogCache.professions && this.catalogCache.expiresAt > Date.now()) {
      return this.catalogCache.professions;
    }

    const entries = await this.getAllProfessionEntries();
    const professions = uniqueStrings(entries.map((entry) => entry.canonicalName))
      .sort((left, right) => left.localeCompare(right));
    this.catalogCache.professions = professions;
    return professions;
  }

  getSearchTerms(entry = {}) {
    return uniqueStrings([
      entry.canonicalName || entry.name || '',
      ...(entry.aliases || []),
      ...(entry.tags || [])
    ]);
  }

  inferEntryDomain(entry = {}) {
    const searchable = this.normalizeProfessionKey(this.getSearchTerms(entry).join(' '));
    if (!searchable) {
      return '';
    }

    let bestDomain = '';
    let bestScore = 0;

    Object.entries(DOMAIN_HINTS).forEach(([domain, hints]) => {
      const score = hints.reduce((total, hint) => (
        searchable.includes(this.normalizeProfessionKey(hint)) ? total + 1 : total
      ), 0);

      if (score > bestScore) {
        bestScore = score;
        bestDomain = domain;
      }
    });

    return bestScore > 0 ? bestDomain : '';
  }

  filterEntriesByDomain(entries = [], domain = '') {
    const normalizedDomain = String(domain || '').trim().toLowerCase();
    if (!normalizedDomain) {
      return entries;
    }

    const filtered = entries.filter((entry) => this.inferEntryDomain(entry) === normalizedDomain);
    return filtered.length > 0 ? filtered : entries;
  }

  stringSimilarity(left = '', right = '') {
    const leftVariants = textNormalizationService.buildVariants(left);
    const rightVariants = textNormalizationService.buildVariants(right);
    let best = 0;

    leftVariants.forEach((leftValue) => {
      rightVariants.forEach((rightValue) => {
        const leftTokens = new Set(String(leftValue || '').split(/\s+/).filter(Boolean));
        const rightTokens = new Set(String(rightValue || '').split(/\s+/).filter(Boolean));
        if (!leftTokens.size || !rightTokens.size) {
          return;
        }

        const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
        const score = (2 * intersection) / (leftTokens.size + rightTokens.size);
        best = Math.max(best, score);
      });
    });

    return best;
  }

  tokenizeProfessionMeaning(value = '') {
    return uniqueStrings(
      this.normalizeProfessionKey(value)
        .split(/\s+/)
        .filter((token) => token && !NEUTRAL_PROFESSION_TOKENS.has(token))
    );
  }

  scoreCandidateTermMatch(candidate = '', term = '') {
    const normalizedCandidate = this.normalizeProfessionKey(candidate);
    const normalizedTerm = this.normalizeProfessionKey(term);
    if (!normalizedCandidate || !normalizedTerm) {
      return 0;
    }

    if (normalizedCandidate === normalizedTerm) {
      return 1;
    }

    let score = this.stringSimilarity(candidate, term);
    const candidateTokens = this.tokenizeProfessionMeaning(candidate);
    const termTokens = this.tokenizeProfessionMeaning(term);
    const overlappingTokens = candidateTokens.filter((token) => termTokens.includes(token));
    const hasSpecificQualifier = candidateTokens.length > termTokens.length
      && termTokens.length > 0
      && termTokens.every((token) => candidateTokens.includes(token));

    if (hasSpecificQualifier) {
      const extraTokenCount = candidateTokens.filter((token) => !termTokens.includes(token)).length;
      const specificityPenalty = Math.min(0.38, extraTokenCount * 0.32);
      score -= specificityPenalty;
    }

    const hasConflictingSpecificTokens = candidateTokens.length > 1
      && termTokens.length > 1
      && overlappingTokens.length > 0
      && overlappingTokens.length < candidateTokens.length
      && overlappingTokens.length < termTokens.length;

    if (hasConflictingSpecificTokens) {
      const differingTokenCount = new Set([
        ...candidateTokens.filter((token) => !termTokens.includes(token)),
        ...termTokens.filter((token) => !candidateTokens.includes(token))
      ]).size;
      const mismatchPenalty = Math.min(0.36, differingTokenCount * 0.18);
      score -= mismatchPenalty;
    }

    return Math.max(0, Number(score.toFixed(4)));
  }

  findBestProfessionMatchSync(candidate = '', entries = [], options = {}) {
    const normalizedCandidate = this.normalizeProfessionKey(candidate);
    if (!normalizedCandidate) {
      return null;
    }

    const minimumScore = Number(options.minimumScore || 0.84);
    let best = null;
    let bestScore = 0;

    entries.forEach((entry) => {
      const terms = this.getSearchTerms(entry);
      const exactTerm = terms.find((term) => this.normalizeProfessionKey(term) === normalizedCandidate);
      const score = exactTerm ? 1 : Math.max(...terms.map((term) => this.scoreCandidateTermMatch(candidate, term)), 0);
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    });

    return bestScore >= minimumScore ? best : null;
  }

  findProfessionMatchesInTextSync(text = '', entries = [], limit = 3) {
    const normalized = textNormalizationService.preprocess(text);
    if (!normalized.normalized) {
      return [];
    }

    return entries
      .map((entry) => {
        const terms = this.getSearchTerms(entry);
        const score = Math.max(...terms.map((term) => this.scoreCandidateTermMatch(normalized.embeddingText, term)), 0);
        return { entry, score };
      })
      .filter((item) => item.score >= 0.35)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((item) => item.entry);
  }

  async ensureEmbeddingForEntry(entry = {}) {
    const targetText = this.buildEmbeddingText(entry);
    const checksum = embeddingService.checksum(targetText);
    const existingChecksum = String(entry.embedding?.checksum || '');

    if (existingChecksum === checksum && Array.isArray(entry.embedding?.vector) && entry.embedding.vector.length > 0) {
      return entry;
    }

    const vector = await embeddingService.embedText(targetText);
    const updated = await ProfessionCatalog.findOneAndUpdate(
      { _id: entry.id },
      {
        $set: {
          embedding: {
            provider: embeddingService.getProvider(),
            model: embeddingService.getModelName(),
            checksum,
            vector,
            text: targetText,
            updatedAt: new Date()
          }
        }
      },
      { new: true }
    ).lean();

    return this.toEntry(updated || entry);
  }

  async ensureEmbeddings(entries = []) {
    const results = [];
    for (const entry of entries) {
      results.push(await this.ensureEmbeddingForEntry(entry));
    }
    return results;
  }

  async createOrUpdateProfession(payload = {}) {
    const canonicalName = this.formatProfessionName(payload.canonicalName || payload.name || '');
    const normalizedKey = this.normalizeProfessionKey(payload.normalizedKey || canonicalName);
    const aliases = uniqueStrings(payload.aliases || []);
    const tags = uniqueStrings(payload.tags || []);
    const relatedProfessions = uniqueStrings(payload.relatedProfessions || []);
    const rawInput = String(payload.rawInput || '').trim();

    if (!canonicalName || !normalizedKey) {
      return null;
    }

    const existingEntries = await this.getAllProfessionEntries();
    const matchedEntry = this.findBestProfessionMatchSync(canonicalName, existingEntries, { minimumScore: 0.93 })
      || aliases.map((alias) => this.findBestProfessionMatchSync(alias, existingEntries, { minimumScore: 0.93 })).find(Boolean);

    const filter = matchedEntry?.id
      ? { _id: matchedEntry.id }
      : {
          $or: [
            { normalizedKey: matchedEntry?.normalizedKey || normalizedKey },
            { normalizedName: matchedEntry?.normalizedKey || normalizedKey }
          ]
        };

    const update = {
      $setOnInsert: {
        canonicalName: matchedEntry?.canonicalName || canonicalName,
        normalizedKey: matchedEntry?.normalizedKey || normalizedKey,
        normalizedName: matchedEntry?.normalizedKey || normalizedKey,
        source: payload.source || matchedEntry?.source || 'learned'
      },
      $set: matchedEntry ? {} : {
        canonicalName,
        normalizedKey,
        normalizedName: normalizedKey
      },
      $addToSet: {
        aliases: {
          $each: uniqueStrings([
            ...aliases,
            ...(matchedEntry && matchedEntry.canonicalName !== canonicalName ? [canonicalName] : [])
          ])
        },
        tags: { $each: tags },
        relatedProfessions: {
          $each: uniqueStrings([
            ...relatedProfessions,
            ...(matchedEntry?.relatedProfessions || []),
            ...(PROFESSION_RELATIONS[matchedEntry?.canonicalName || canonicalName] || [])
          ])
        }
      }
    };

    if (rawInput) {
      update.$addToSet['learning.rawInputs'] = rawInput;
    }

    const updated = await ProfessionCatalog.findOneAndUpdate(
      filter,
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    this.invalidateCache();

    const entry = this.toEntry(updated);
    return this.ensureEmbeddingForEntry(entry);
  }

  async ensureProfession(value = '', options = {}) {
    const cleaned = this.formatProfessionName(value);
    if (!cleaned) {
      return '';
    }

    const existing = await this.findBestProfessionMatch(cleaned);
    if (existing) {
      return existing.canonicalName || existing.name || '';
    }

    const allowCreate = options.allowCreate === true;
    if (!allowCreate) {
      return '';
    }

    const saved = await this.createOrUpdateProfession({
      canonicalName: cleaned,
      aliases: options.aliases || [],
      tags: options.tags || [],
      relatedProfessions: options.relatedProfessions || [],
      source: options.source || 'learned',
      rawInput: options.rawInput || value
    });

    return saved?.canonicalName || '';
  }

  async markProfessionSelected(canonicalName = '', rawInput = '') {
    const entry = await this.findBestProfessionMatch(canonicalName);
    if (!entry) {
      return null;
    }

    const update = {
      $inc: {
        'learning.usageCount': 1,
        'learning.selectedCount': 1
      },
      $set: {
        'learning.lastSelectedAt': new Date()
      }
    };

    if (rawInput) {
      update.$addToSet = {
        'learning.rawInputs': String(rawInput).trim()
      };
    }

    await ProfessionCatalog.findOneAndUpdate({ _id: entry.id }, update);
    this.invalidateCache();

    return entry;
  }

  invalidateCache() {
    this.catalogCache.entries = null;
    this.catalogCache.professions = null;
    this.catalogCache.expiresAt = 0;
  }

  async findBestProfessionMatch(candidate = '') {
    const entries = await this.getAllProfessionEntries();
    return this.findBestProfessionMatchSync(candidate, entries);
  }
}

module.exports = new ProfessionCatalogService();
