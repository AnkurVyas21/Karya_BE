const ProfessionInferenceLog = require('../models/ProfessionInferenceLog');
const logger = require('../utils/logger');
const embeddingService = require('./embeddingService');
const professionCatalogService = require('./professionCatalogService');
const textNormalizationService = require('./textNormalizationService');
const intentExtractionService = require('./intentExtractionService');
const contextSuggestionService = require('./contextSuggestionService');

const MATCH_THRESHOLD = Number(process.env.PROFESSION_MATCH_THRESHOLD || 0.78);
const CONFIRM_THRESHOLD = Number(process.env.PROFESSION_CONFIRM_THRESHOLD || 0.86);
const SUGGESTION_THRESHOLD = Number(process.env.PROFESSION_SUGGESTION_THRESHOLD || 0.56);
const SEMANTIC_CANDIDATE_THRESHOLD = Number(process.env.PROFESSION_SEMANTIC_CANDIDATE_THRESHOLD || 0.5);
const LEXICAL_CANDIDATE_THRESHOLD = Number(process.env.PROFESSION_LEXICAL_CANDIDATE_THRESHOLD || 0.2);
const AUTO_SELECT_MARGIN_THRESHOLD = Number(process.env.PROFESSION_AUTO_SELECT_MARGIN_THRESHOLD || 0.08);
const MAX_CANDIDATES = Math.max(Number(process.env.PROFESSION_TOP_K || 8), 5);

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

    const intent = options.intent || await intentExtractionService.extractIntent(preprocessed.raw, {
      context: options.context || 'profession-inference',
      allowedProfessionNames: options.allowedProfessionNames || [],
      professionCatalogEntries: entries
    });

    const candidateEntries = this.buildCandidateEntries(preprocessed, intent, entries, topN);
    const candidateListBeforeFiltering = candidateEntries.map((entry) => entry.canonicalName);
    const semanticResult = await this.rankSemanticCandidates(preprocessed, intent, candidateEntries, entries, topN);
    const hasSemanticCandidates = semanticResult.candidates.length > 0;
    const fallbackSuggestions = hasSemanticCandidates
      ? []
      : this.buildFallbackSuggestions(intent, candidateEntries, entries);
    const suggestions = hasSemanticCandidates ? semanticResult.candidates : fallbackSuggestions;
    const bestSuggestion = suggestions[0] || null;
    const runnerUpSuggestion = suggestions[1] || null;
    const autoSelectMargin = bestSuggestion && runnerUpSuggestion
      ? Number((bestSuggestion.confidence - runnerUpSuggestion.confidence).toFixed(4))
      : Number(bestSuggestion?.confidence || 0);
    const canAutoSelect = hasSemanticCandidates
      && bestSuggestion
      && bestSuggestion.source === 'semantic'
      && bestSuggestion.confidence >= CONFIRM_THRESHOLD
      && Number(bestSuggestion.scoreBreakdown?.semanticScore || 0) >= MATCH_THRESHOLD
      && autoSelectMargin >= AUTO_SELECT_MARGIN_THRESHOLD;
    const isGenericFallback = Boolean(bestSuggestion && !bestSuggestion.professionId && bestSuggestion.source.startsWith('fallback'));
    const canSuggest = bestSuggestion
      && (
        (bestSuggestion.source === 'semantic' && bestSuggestion.confidence >= SUGGESTION_THRESHOLD)
        || bestSuggestion.source.startsWith('fallback')
      );
    const status = canAutoSelect
      ? 'confirmed'
      : (canSuggest || (isGenericFallback && Number(bestSuggestion?.confidence || 0) >= 0.68))
        ? 'needs_confirmation'
        : 'unknown';
    const contextSuggestions = await contextSuggestionService.suggest({
      context: intent.context,
      keywords: intent.keywords,
      primaryProfession: bestSuggestion?.canonicalName || '',
      professionCatalogEntries: entries,
      limit: 6
    });

    logger.info('Profession inference debug', {
      context: options.context || 'profession-inference',
      input: preprocessed.raw,
      normalizedInput: preprocessed.normalized,
      intentExtraction: {
        primary_intent: intent.primary_intent,
        context: intent.context,
        keywords: intent.keywords,
        suggested_professions: intent.suggested_professions
      },
      candidateListBeforeFiltering,
      candidateSourceUsed: hasSemanticCandidates ? 'semantic' : (fallbackSuggestions.length > 0 ? 'fallback' : 'none'),
      topMatches: suggestions.map((item) => ({
        profession: item.canonicalName,
        semanticScore: Number(item.scoreBreakdown?.semanticScore || item.similarity || 0),
        lexicalScore: Number(item.scoreBreakdown?.lexicalScore || 0),
        keywordBoost: Number(item.scoreBreakdown?.keywordBoost || 0),
        finalScore: Number(item.scoreBreakdown?.finalScore || item.confidence || 0),
        source: item.source
      })),
      selectedProfession: canAutoSelect ? bestSuggestion?.canonicalName || '' : '',
      selectedScoreBreakdown: bestSuggestion?.scoreBreakdown || null,
      fallbackUsed: !hasSemanticCandidates || semanticResult.embeddingFailed
    });

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
          suggestions: suggestions.map((item) => ({
            professionId: item.professionId || null,
            canonicalName: item.canonicalName,
            normalizedKey: item.normalizedKey,
            confidence: item.confidence,
            similarity: item.similarity,
            source: item.source,
            metadata: item.scoreBreakdown || null
          })),
          metadata: {
            catalogSize: entries.length,
            detectedProfession: bestSuggestion?.canonicalName || '',
            status,
            candidateSourceUsed: hasSemanticCandidates ? 'semantic' : (fallbackSuggestions.length > 0 ? 'fallback' : 'none'),
            fallbackUsed: !hasSemanticCandidates || semanticResult.embeddingFailed,
            selectedScoreBreakdown: bestSuggestion?.scoreBreakdown || null,
            intentExtraction: {
              primary_intent: intent.primary_intent,
              context: intent.context,
              keywords: intent.keywords,
              suggested_professions: intent.suggested_professions
            }
          }
        });

    return {
      inferenceId: log?._id?.toString?.() || '',
      profession_name: (canSuggest || canAutoSelect) ? (bestSuggestion?.canonicalName || '') : '',
      profession: canAutoSelect ? (bestSuggestion?.canonicalName || '') : 'unknown',
      suggestedProfession: canSuggest ? (bestSuggestion?.canonicalName || '') : '',
      status,
      requiresConfirmation: status === 'needs_confirmation',
      confidence: Number(bestSuggestion?.confidence || 0),
      matchedText: bestSuggestion?.canonicalName || '',
      reason: status === 'confirmed'
        ? 'Matched the primary profession from extracted intent and semantic ranking.'
        : status === 'needs_confirmation'
          ? 'Found a likely primary profession, but confirmation is recommended.'
          : 'No confident primary profession match was found.',
      aliases: bestSuggestion?.aliases || [],
      specializations: bestSuggestion?.tags || [],
      tags: uniqueStrings([
        ...(bestSuggestion?.tags || []),
        ...(intent?.keywords || [])
      ]).slice(0, 8),
      similarProfessions: suggestions.slice(1).map((item) => item.canonicalName),
      contextSuggestions,
      professions: suggestions.map((item) => item.canonicalName),
      suggestions: suggestions.map((item) => ({
        profession: item.canonicalName,
        confidence: item.confidence,
        similarity: item.similarity,
        source: item.source,
        scoreBreakdown: item.scoreBreakdown || null
      })),
      intent: {
        primary_intent: intent.primary_intent,
        context: intent.context,
        keywords: intent.keywords,
        suggested_professions: intent.suggested_professions
      },
      debug: {
        candidateSourceUsed: hasSemanticCandidates ? 'semantic' : (fallbackSuggestions.length > 0 ? 'fallback' : 'none'),
        embeddingFailed: semanticResult.embeddingFailed,
        autoSelectMargin
      }
    };
  }

  buildCandidateEntries(preprocessed, intent = {}, entries = [], topN = 5) {
    const explicitEntries = professionCatalogService.findProfessionMatchesInTextSync(preprocessed.raw, entries, Math.max(topN, 5));
    const intentEntries = uniqueStrings(intent.suggested_professions || [])
      .map((candidate) => professionCatalogService.findBestProfessionMatchSync(candidate, entries, { minimumScore: 0.58 }))
      .filter(Boolean);
    const all = uniqueStrings([
      ...intentEntries.map((entry) => entry.canonicalName),
      ...explicitEntries.map((entry) => entry.canonicalName)
    ]);

    return all
      .map((profession) => professionCatalogService.findBestProfessionMatchSync(profession, entries, { minimumScore: 0.58 }))
      .filter(Boolean)
      .slice(0, Math.max(topN, MAX_CANDIDATES));
  }

  async rankSemanticCandidates(preprocessed, intent = {}, candidateEntries = [], allEntries = [], topN = 5) {
    const rankingEntries = candidateEntries.length > 0 ? candidateEntries : [];
    const embeddingText = this.buildIntentEmbeddingText(preprocessed, intent);
    let queryVector = null;
    let embeddingFailed = false;

    try {
      const entriesWithEmbeddings = await professionCatalogService.ensureEmbeddings(rankingEntries);
      queryVector = await embeddingService.embedText(embeddingText);
      const ranked = entriesWithEmbeddings
        .map((entry) => this.scoreSemanticCandidate(entry, queryVector, intent, preprocessed))
        .filter((item) => this.isSemanticCandidate(item))
        .sort((left, right) => this.compareCandidates(left, right))
        .slice(0, Math.max(topN, MAX_CANDIDATES));

      return {
        embeddingFailed,
        candidates: ranked.map((item) => this.toSuggestion(item, 'semantic'))
      };
    } catch (error) {
      embeddingFailed = true;
      logger.warn(`Profession embedding ranking failed: ${error.message}`);
    }

    return {
      embeddingFailed,
      candidates: []
    };
  }

  buildFallbackSuggestions(intent = {}, candidateEntries = [], allEntries = []) {
    const matchedPool = candidateEntries.length > 0
      ? candidateEntries
      : uniqueStrings(intent.suggested_professions || [])
        .map((candidate) => professionCatalogService.findBestProfessionMatchSync(candidate, allEntries, { minimumScore: 0.58 }))
        .filter(Boolean);
    const syntheticTags = uniqueStrings(intent.keywords || []).slice(0, 8);
    const syntheticPool = matchedPool.length === 0
      ? uniqueStrings(intent.suggested_professions || []).map((profession) => ({
          id: null,
          canonicalName: professionCatalogService.formatProfessionName(profession),
          normalizedKey: professionCatalogService.normalizeProfessionKey(profession),
          aliases: [],
          tags: syntheticTags
        }))
      : [];
    const pool = matchedPool.length > 0 ? matchedPool : syntheticPool;

    return pool.slice(0, MAX_CANDIDATES).map((entry, index) => ({
      professionId: entry.id,
      canonicalName: entry.canonicalName,
      normalizedKey: entry.normalizedKey,
      confidence: Number(Math.max(0.45, 0.72 - (index * 0.05)).toFixed(4)),
      similarity: 0,
      aliases: entry.aliases || [],
      tags: entry.tags || [],
      source: 'fallback-intent',
      scoreBreakdown: {
        semanticScore: 0,
        lexicalScore: Number(index === 0 ? 1 : Math.max(0.4, 0.82 - (index * 0.08)).toFixed(4)),
        keywordBoost: Number(index === 0 ? 0.15 : 0.08),
        popularityScore: 0,
        finalScore: Number(Math.max(0.45, 0.72 - (index * 0.05)).toFixed(4))
      }
    }));
  }

  buildIntentEmbeddingText(preprocessed, intent = {}) {
    return uniqueStrings([
      intent.primary_intent || '',
      intent.context || '',
      ...(intent.keywords || []),
      ...(intent.suggested_professions || []),
      preprocessed.embeddingText
    ]).join(' | ');
  }

  scoreSemanticCandidate(entry = {}, queryVector = [], intent = {}, preprocessed = {}) {
    const semanticScore = embeddingService.cosineSimilarity(queryVector, entry.embedding?.vector || []);
    const lexicalTerms = uniqueStrings([
      entry.canonicalName,
      ...(entry.aliases || []),
      ...(entry.tags || [])
    ]);
    const lexicalScore = Math.max(
      ...lexicalTerms.map((term) => professionCatalogService.stringSimilarity(
        uniqueStrings([intent.primary_intent, ...intent.keywords || [], preprocessed.raw]).join(' '),
        term
      )),
      0
    );
    const keywordBoost = this.getIntentBoost(entry, intent);
    const popularityScore = this.toPopularityScore(entry);
    const finalScore = this.toConfidence(semanticScore, lexicalScore, popularityScore, keywordBoost);

    return {
      entry,
      semanticScore,
      lexicalScore,
      keywordBoost,
      popularityScore,
      confidence: finalScore
    };
  }

  getIntentBoost(entry = {}, intent = {}) {
    const normalizedProfession = professionCatalogService.normalizeProfessionKey(entry.canonicalName);
    const normalizedSuggestions = new Set((intent.suggested_professions || []).map((item) => professionCatalogService.normalizeProfessionKey(item)));
    const normalizedKeywords = uniqueStrings(intent.keywords || []).map((item) => item.toLowerCase());
    let boost = normalizedSuggestions.has(normalizedProfession) ? 0.18 : 0;

    if ((entry.tags || []).some((tag) => normalizedKeywords.includes(String(tag || '').toLowerCase()))) {
      boost += 0.08;
    }

    if ((entry.aliases || []).some((alias) => normalizedKeywords.includes(String(alias || '').toLowerCase()))) {
      boost += 0.06;
    }

    return Number(Math.min(0.25, boost).toFixed(4));
  }

  toConfidence(semanticScore = 0, lexicalScore = 0, popularityScore = 0, keywordBoost = 0) {
    const semantic = Math.max(0, Math.min(1, (semanticScore + 1) / 2));
    const lexical = Math.max(0, Math.min(1, lexicalScore));
    const popularity = Math.max(0, Math.min(1, popularityScore));
    const boost = Math.max(0, Math.min(1, keywordBoost));
    return Number((semantic * 0.84 + lexical * 0.12 + boost * 0.03 + popularity * 0.01).toFixed(4));
  }

  isSemanticCandidate(item = {}) {
    return Number(item.semanticScore || 0) >= SEMANTIC_CANDIDATE_THRESHOLD
      || Number(item.lexicalScore || 0) >= LEXICAL_CANDIDATE_THRESHOLD;
  }

  compareCandidates(left = {}, right = {}) {
    if (Number(right.semanticScore || 0) !== Number(left.semanticScore || 0)) {
      return Number(right.semanticScore || 0) - Number(left.semanticScore || 0);
    }
    if (Number(right.lexicalScore || 0) !== Number(left.lexicalScore || 0)) {
      return Number(right.lexicalScore || 0) - Number(left.lexicalScore || 0);
    }
    return Number(right.confidence || 0) - Number(left.confidence || 0);
  }

  toSuggestion(item = {}, source = 'semantic') {
    return {
      professionId: item.entry.id,
      canonicalName: item.entry.canonicalName,
      normalizedKey: item.entry.normalizedKey,
      confidence: item.confidence,
      similarity: Number(item.semanticScore.toFixed(4)),
      aliases: item.entry.aliases || [],
      tags: item.entry.tags || [],
      source,
      scoreBreakdown: {
        semanticScore: Number(item.semanticScore.toFixed(4)),
        lexicalScore: Number(item.lexicalScore.toFixed(4)),
        keywordBoost: Number(item.keywordBoost.toFixed(4)),
        popularityScore: Number(item.popularityScore.toFixed(4)),
        finalScore: item.confidence
      }
    };
  }

  toPopularityScore(entry = {}) {
    const usageCount = Number(entry.learning?.selectedCount || entry.learning?.usageCount || 0);
    if (!usageCount) {
      return 0;
    }
    return Math.min(1, Math.log10(usageCount + 1) / 2);
  }

  async recordSelection(inferenceId = '', selectedProfession = '', options = {}) {
    const canonicalName = String(selectedProfession || '').trim();
    if (!canonicalName) {
      return null;
    }

    const matchedEntry = await professionCatalogService.createOrUpdateProfession({
      canonicalName,
      aliases: options.aliases || [],
      tags: [],
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
