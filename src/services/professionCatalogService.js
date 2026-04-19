const DEFAULT_PROFESSIONS = require('../constants/professions');
const ProfessionCatalog = require('../models/ProfessionCatalog');
const embeddingService = require('./embeddingService');
const textNormalizationService = require('./textNormalizationService');

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

class ProfessionCatalogService {
  async ensureSystemCatalog() {
    for (const profession of DEFAULT_PROFESSIONS) {
      const canonicalName = this.formatProfessionName(profession);
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
            aliases: [],
            tags: [],
            source: 'system'
          }
        },
        { upsert: true }
      );
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
      source: doc.source || 'learned',
      embedding: doc.embedding || {},
      learning: doc.learning || {}
    };
  }

  async getAllProfessionEntries() {
    await this.ensureSystemCatalog();
    const rows = await ProfessionCatalog.find({})
      .sort({ canonicalName: 1, name: 1 })
      .lean();

    return rows
      .map((row) => this.toEntry(row))
      .filter((entry) => entry.canonicalName);
  }

  async getAllProfessions() {
    const entries = await this.getAllProfessionEntries();
    return uniqueStrings(entries.map((entry) => entry.canonicalName))
      .sort((left, right) => left.localeCompare(right));
  }

  getSearchTerms(entry = {}) {
    return uniqueStrings([
      entry.canonicalName || entry.name || '',
      ...(entry.aliases || []),
      ...(entry.tags || [])
    ]);
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
      const score = exactTerm ? 1 : Math.max(...terms.map((term) => this.stringSimilarity(candidate, term)), 0);
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
        const score = Math.max(...terms.map((term) => this.stringSimilarity(normalized.embeddingText, term)), 0);
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
    const rawInput = String(payload.rawInput || '').trim();

    if (!canonicalName || !normalizedKey) {
      return null;
    }

    const existingEntries = await this.getAllProfessionEntries();
    const matchedEntry = this.findBestProfessionMatchSync(canonicalName, existingEntries, { minimumScore: 0.93 })
      || aliases.map((alias) => this.findBestProfessionMatchSync(alias, existingEntries, { minimumScore: 0.93 })).find(Boolean);

    const filter = matchedEntry?.id
      ? { _id: matchedEntry.id }
      : { normalizedKey: matchedEntry?.normalizedKey || normalizedKey };

    const update = {
      $setOnInsert: {
        canonicalName: matchedEntry?.canonicalName || canonicalName,
        normalizedKey: matchedEntry?.normalizedKey || normalizedKey,
        source: payload.source || matchedEntry?.source || 'learned'
      },
      $set: matchedEntry ? {} : {
        canonicalName,
        normalizedKey
      },
      $addToSet: {
        aliases: {
          $each: uniqueStrings([
            ...aliases,
            ...(matchedEntry && matchedEntry.canonicalName !== canonicalName ? [canonicalName] : [])
          ])
        },
        tags: { $each: tags }
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

    const entry = this.toEntry(updated);
    return this.ensureEmbeddingForEntry(entry);
  }

  async ensureProfession(value = '', options = {}) {
    const saved = await this.createOrUpdateProfession({
      canonicalName: value,
      aliases: options.aliases || [],
      tags: options.tags || [],
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

    return entry;
  }

  async findBestProfessionMatch(candidate = '') {
    const entries = await this.getAllProfessionEntries();
    return this.findBestProfessionMatchSync(candidate, entries);
  }
}

module.exports = new ProfessionCatalogService();
