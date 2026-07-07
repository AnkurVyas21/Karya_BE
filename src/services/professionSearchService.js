const professionCatalogService = require('./professionCatalogService');
const professionInferenceService = require('./professionInferenceService');
const TtlCache = require('../utils/ttlCache');

const FILTER_CACHE_TTL_MS = Math.max(Number(process.env.PROFESSION_FILTER_CACHE_TTL_MS || 2 * 60 * 1000), 1000);
const FILTER_CACHE_MAX = Math.max(Number(process.env.PROFESSION_FILTER_CACHE_MAX || 1000), 50);
const filterCache = new TtlCache({ ttlMs: FILTER_CACHE_TTL_MS, maxSize: FILTER_CACHE_MAX });

const uniqueStrings = (values = []) => [...new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)];

class ProfessionSearchService {
  async resolveSearchFilters(filters = {}) {
    const professionInput = String(filters.profession || '').trim();
    const queryInput = String(filters.query || '').trim();
    const cacheKey = JSON.stringify({
      profession: professionInput.toLowerCase(),
      query: queryInput.toLowerCase()
    });
    const cached = filterCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const entries = await professionCatalogService.getAllProfessionEntries();
    const exactProfessionEntry = professionInput
      ? professionCatalogService.findBestProfessionMatchSync(professionInput, entries, { minimumScore: 1 })
      : null;

    if (exactProfessionEntry) {
      return filterCache.set(cacheKey, {
        profession: exactProfessionEntry.canonicalName,
        professionCandidates: [exactProfessionEntry.canonicalName],
        professionTerms: professionCatalogService.getSearchTerms(exactProfessionEntry),
        semanticSuggestions: [exactProfessionEntry.canonicalName]
      });
    }

    const exactQueryEntry = queryInput && !professionInput
      ? professionCatalogService.findBestProfessionMatchSync(queryInput, entries, { minimumScore: 1 })
      : null;

    if (exactQueryEntry) {
      return filterCache.set(cacheKey, {
        profession: exactQueryEntry.canonicalName,
        professionCandidates: [exactQueryEntry.canonicalName],
        professionTerms: professionCatalogService.getSearchTerms(exactQueryEntry),
        semanticSuggestions: [exactQueryEntry.canonicalName]
      });
    }

    const professionInference = professionInput
      ? await professionInferenceService.inferProfession(professionInput, {
          context: 'search-profession-filter',
          log: false,
          topN: 4
      })
      : null;

    const queryInference = queryInput && !professionInput
      ? await professionInferenceService.inferProfession(queryInput, {
          context: 'search-query',
          log: false,
          topN: 4
        })
      : null;

    const professionCandidates = uniqueStrings([
      ...((professionInference && professionInference.status !== 'unknown') ? [
        professionInference.suggestedProfession || '',
        ...(professionInference.similarProfessions || [])
      ] : []),
      ...((queryInference && queryInference.status !== 'unknown') ? [
        queryInference.suggestedProfession || '',
        ...(queryInference.similarProfessions || [])
      ] : [])
    ]);

    const resolvedEntries = professionCandidates
      .map((candidate) => professionCatalogService.findBestProfessionMatchSync(candidate, entries, { minimumScore: 0.7 }))
      .filter(Boolean);

    return filterCache.set(cacheKey, {
      profession: professionInference?.status === 'confirmed'
        ? professionInference.suggestedProfession
        : professionInput,
      professionCandidates: uniqueStrings(resolvedEntries.map((entry) => entry.canonicalName)),
      professionTerms: uniqueStrings(resolvedEntries.flatMap((entry) => professionCatalogService.getSearchTerms(entry))),
      semanticSuggestions: uniqueStrings([
        ...(professionInference?.professions || []),
        ...(queryInference?.professions || [])
      ])
    });
  }
}

module.exports = new ProfessionSearchService();
