const ProfessionInferenceLog = require('../models/ProfessionInferenceLog');
const embeddingService = require('./embeddingService');
const professionCatalogService = require('./professionCatalogService');
const textNormalizationService = require('./textNormalizationService');

const uniqueStrings = (values = []) => [...new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)];

class ProfessionInferenceService {
  async inferProfession(rawInput = '', options = {}) {
    const topN = Math.max(Number(options.topN) || 5, 1);
    const preprocessed = textNormalizationService.preprocess(rawInput);
    if (!preprocessed.raw) {
      throw new Error('Description is required');
    }

    let entries = await professionCatalogService.getAllProfessionEntries();
    if (Array.isArray(options.allowedProfessionNames) && options.allowedProfessionNames.length > 0) {
      const allowed = new Set(options.allowedProfessionNames.map((item) => professionCatalogService.normalizeProfessionKey(item)).filter(Boolean));
      entries = entries.filter((entry) => allowed.has(entry.normalizedKey));
    }

    entries = await professionCatalogService.ensureEmbeddings(entries);
    const queryVector = await embeddingService.embedText(preprocessed.embeddingText);

    const ranked = entries
      .map((entry) => {
        const semanticScore = embeddingService.cosineSimilarity(queryVector, entry.embedding?.vector || []);
        const lexicalScore = Math.max(
          professionCatalogService.stringSimilarity(preprocessed.raw, entry.canonicalName),
          ...professionCatalogService.getSearchTerms(entry).map((term) => professionCatalogService.stringSimilarity(preprocessed.embeddingText, term)),
          0
        );
        const confidence = this.toConfidence(semanticScore, lexicalScore);
        return {
          entry,
          confidence,
          semanticScore,
          lexicalScore,
          source: 'catalog'
        };
      })
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, topN);

    const top = ranked[0] || null;
    const syntheticSuggestion = (!top || top.confidence < 0.58)
      ? await this.synthesizeCanonicalProfession(preprocessed, ranked)
      : null;

    const suggestions = [
      ...ranked.map((item) => ({
        professionId: item.entry.id,
        profession: item.entry.canonicalName,
        canonicalName: item.entry.canonicalName,
        normalizedKey: item.entry.normalizedKey,
        confidence: item.confidence,
        similarity: item.semanticScore,
        source: item.source,
        aliases: item.entry.aliases || [],
        tags: item.entry.tags || []
      })),
      ...(syntheticSuggestion ? [syntheticSuggestion] : [])
    ].sort((left, right) => right.confidence - left.confidence);

    const dedupedSuggestions = [];
    const seen = new Set();
    suggestions.forEach((suggestion) => {
      const key = professionCatalogService.normalizeProfessionKey(suggestion.canonicalName || suggestion.profession);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      dedupedSuggestions.push(suggestion);
    });

    const bestSuggestion = dedupedSuggestions[0] || null;
    const status = bestSuggestion && bestSuggestion.confidence >= 0.8
      ? 'confirmed'
      : bestSuggestion
        ? 'needs_confirmation'
        : 'unknown';

    const log = options.log === false
      ? null
      : await ProfessionInferenceLog.create({
          context: options.context || 'profession-inference',
          userId: options.userId || null,
          rawInput: preprocessed.raw,
          normalizedInput: preprocessed.normalized,
          transliteratedInput: preprocessed.transliterated,
          variants: preprocessed.variants,
          provider: embeddingService.getProvider(),
          model: embeddingService.getModelName(),
          suggestions: dedupedSuggestions.map((item) => ({
            professionId: item.professionId || null,
            canonicalName: item.canonicalName,
            normalizedKey: item.normalizedKey,
            confidence: item.confidence,
            similarity: item.similarity,
            source: item.source
          })),
          metadata: {
            catalogSize: entries.length,
            detectedProfession: bestSuggestion?.canonicalName || '',
            status
          }
        });

    return {
      inferenceId: log?._id?.toString?.() || '',
      profession: status === 'confirmed' ? (bestSuggestion?.canonicalName || '') : 'unknown',
      suggestedProfession: bestSuggestion?.canonicalName || '',
      status,
      requiresConfirmation: status === 'needs_confirmation',
      confidence: Number(bestSuggestion?.confidence || 0),
      matchedText: bestSuggestion?.canonicalName || '',
      reason: status === 'confirmed'
        ? 'Matched the input to the closest canonical profession using semantic similarity.'
        : status === 'needs_confirmation'
          ? 'Found likely profession matches, but a confirmation is recommended.'
          : 'No confident profession match was found.',
      aliases: bestSuggestion?.aliases || [],
      specializations: bestSuggestion?.tags || [],
      tags: bestSuggestion?.tags || [],
      similarProfessions: dedupedSuggestions.slice(1).map((item) => item.canonicalName),
      suggestions: dedupedSuggestions.map((item) => ({
        profession: item.canonicalName,
        confidence: item.confidence,
        similarity: item.similarity,
        source: item.source
      })),
      professions: dedupedSuggestions.map((item) => item.canonicalName)
    };
  }

  toConfidence(semanticScore = 0, lexicalScore = 0) {
    const semantic = Math.max(0, Math.min(1, (semanticScore + 1) / 2));
    const lexical = Math.max(0, Math.min(1, lexicalScore));
    return Number((semantic * 0.88 + lexical * 0.12).toFixed(4));
  }

  async synthesizeCanonicalProfession(preprocessed, rankedSuggestions = []) {
    const fallback = professionCatalogService.formatProfessionName(
      preprocessed.raw
        .split(/[,.!?:;|/-]+/)[0]
        .split(/\s+/)
        .slice(0, 4)
        .join(' ')
    );

    if (!fallback) {
      return null;
    }

    return {
      professionId: null,
      profession: fallback,
      canonicalName: fallback,
      normalizedKey: professionCatalogService.normalizeProfessionKey(fallback),
      confidence: rankedSuggestions[0] ? Math.max(0.34, rankedSuggestions[0].confidence - 0.1) : 0.36,
      similarity: rankedSuggestions[0]?.semanticScore || 0,
      source: 'synthesized',
      aliases: [],
      tags: []
    };
  }

  async recordSelection(inferenceId = '', selectedProfession = '', options = {}) {
    const canonicalName = String(selectedProfession || '').trim();
    if (!canonicalName) {
      return null;
    }

    const matchedEntry = await professionCatalogService.createOrUpdateProfession({
      canonicalName,
      aliases: options.aliases || [],
      tags: options.tags || [],
      source: options.source || 'selection',
      rawInput: options.rawInput || canonicalName
    });

    if (inferenceId) {
      await ProfessionInferenceLog.findByIdAndUpdate(inferenceId, {
        $set: {
          selectedProfessionId: matchedEntry?._id || matchedEntry?.id || null,
          selectedCanonicalName: matchedEntry?.canonicalName || canonicalName,
          selectionSource: options.source || 'selection'
        }
      });
    }

    await professionCatalogService.markProfessionSelected(matchedEntry?.canonicalName || canonicalName, options.rawInput || '');
    return matchedEntry;
  }
}

module.exports = new ProfessionInferenceService();
