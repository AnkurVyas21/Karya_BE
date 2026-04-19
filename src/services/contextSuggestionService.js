const professionCatalogService = require('./professionCatalogService');
const textNormalizationService = require('./textNormalizationService');
const { CONTEXT_PROFESSIONS, PROFESSION_RELATIONS } = require('../constants/professionContextData');

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

class ContextSuggestionService {
  async suggest(input = {}) {
    const limit = Math.max(Number(input.limit) || 5, 1);
    const entries = Array.isArray(input.professionCatalogEntries) && input.professionCatalogEntries.length > 0
      ? input.professionCatalogEntries
      : await professionCatalogService.getAllProfessionEntries();
    const contextKeys = this.toContextKeys(input.context, input.keywords);
    const contextMatches = contextKeys.flatMap((key) => CONTEXT_PROFESSIONS[key] || []);
    const primaryMatch = professionCatalogService.findBestProfessionMatchSync(input.primaryProfession, entries, { minimumScore: 0.7 });
    const professionRelations = [
      ...(primaryMatch?.relatedProfessions || []),
      ...(PROFESSION_RELATIONS[primaryMatch?.canonicalName || input.primaryProfession] || [])
    ];

    return uniqueStrings([
      ...contextMatches,
      ...professionRelations
    ])
      .filter((profession) => {
        const normalized = textNormalizationService.normalizeProfessionKey(profession);
        return normalized && normalized !== textNormalizationService.normalizeProfessionKey(input.primaryProfession || '');
      })
      .slice(0, limit);
  }

  toContextKeys(context = '', keywords = []) {
    return uniqueStrings([
      context,
      ...(keywords || [])
    ]).flatMap((value) => textNormalizationService.buildVariants(value));
  }
}

module.exports = new ContextSuggestionService();
