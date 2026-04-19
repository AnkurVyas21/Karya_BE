const professionCatalogService = require('./professionCatalogService');
const professionInferenceService = require('./professionInferenceService');

const uniqueStrings = (values = []) => [...new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)];

class ProfessionSearchService {
  async resolveSearchFilters(filters = {}) {
    const professionInput = String(filters.profession || '').trim();
    const queryInput = String(filters.query || '').trim();

    const professionInference = professionInput
      ? await professionInferenceService.inferProfession(professionInput, {
          context: 'search-profession-filter',
          log: false,
          topN: 4
        })
      : null;

    const queryInference = queryInput
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

    const entries = await professionCatalogService.getAllProfessionEntries();
    const resolvedEntries = professionCandidates
      .map((candidate) => professionCatalogService.findBestProfessionMatchSync(candidate, entries, { minimumScore: 0.7 }))
      .filter(Boolean);

    return {
      profession: professionInference?.status === 'confirmed'
        ? professionInference.suggestedProfession
        : professionInput,
      professionCandidates: uniqueStrings(resolvedEntries.map((entry) => entry.canonicalName)),
      professionTerms: uniqueStrings(resolvedEntries.flatMap((entry) => professionCatalogService.getSearchTerms(entry))),
      semanticSuggestions: uniqueStrings([
        ...(professionInference?.professions || []),
        ...(queryInference?.professions || [])
      ])
    };
  }
}

module.exports = new ProfessionSearchService();
