const ProfessionInferenceLog = require('../models/ProfessionInferenceLog');
const embeddingService = require('./embeddingService');
const professionCatalogService = require('./professionCatalogService');
const textNormalizationService = require('./textNormalizationService');
const logger = require('../utils/logger');

const MATCH_THRESHOLD = Number(process.env.PROFESSION_MATCH_THRESHOLD || 0.78);
const CONFIRM_THRESHOLD = Number(process.env.PROFESSION_CONFIRM_THRESHOLD || 0.86);
const CREATE_THRESHOLD = Number(process.env.PROFESSION_CREATE_THRESHOLD || 0.82);
const CANDIDATE_THRESHOLD = Number(process.env.PROFESSION_CANDIDATE_THRESHOLD || 0.44);
const MIN_LEXICAL_SCORE = Number(process.env.PROFESSION_MIN_LEXICAL_SCORE || 0.04);
const SUGGESTION_THRESHOLD = Number(process.env.PROFESSION_SUGGESTION_THRESHOLD || 0.5);
const MAX_CANDIDATES = Math.max(Number(process.env.PROFESSION_TOP_K || 8), 5);
const LLM_PROVIDER = String(process.env.PROFESSION_LLM_PROVIDER || process.env.PROFESSION_EMBEDDING_PROVIDER || '').trim().toLowerCase();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

const KEYWORD_BOOSTS = {
  caterer: ['khana', 'khane', 'bhojan', 'halwai', 'catering', 'caterer', 'cook', 'cooking', 'order', 'food', 'rasoi', 'shaadi', 'shadi', 'wedding'],
  'mehendi artist': ['mehndi', 'mehendi', 'henna', 'bridal mehndi', 'bridal mehendi', 'shaadi', 'shadi', 'wedding'],
  beautician: ['makeup', 'bridal makeup', 'parlour', 'beauty', 'salon'],
  photographer: ['photo', 'photography', 'camera', 'wedding shoot', 'photoshoot'],
  videographer: ['video', 'videography', 'reel', 'shoot'],
  'event planner': ['event', 'wedding', 'shaadi', 'shadi', 'planner', 'arrangement'],
  driver: ['gaadi', 'car', 'driver', 'driving'],
  electrician: ['bijli', 'wiring', 'switch', 'light', 'electric'],
  plumber: ['nal', 'pipe', 'paani', 'leak', 'bathroom', 'tap'],
  'dhol player': ['dhol', 'baraat', 'band', 'wedding'],
  'ghodi service': ['ghodi', 'baraat', 'dulha', 'wedding horse']
};

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

    const broadRanked = entries
      .map((entry) => {
        const semanticScore = embeddingService.cosineSimilarity(queryVector, entry.embedding?.vector || []);
        const lexicalScore = Math.max(
          professionCatalogService.stringSimilarity(preprocessed.raw, entry.canonicalName),
          ...professionCatalogService.getSearchTerms(entry).map((term) => professionCatalogService.stringSimilarity(preprocessed.embeddingText, term)),
          0
        );
        const keywordBoost = this.getKeywordBoost(preprocessed, entry);
        const popularityScore = this.toPopularityScore(entry);
        const confidence = this.toConfidence(semanticScore, lexicalScore, popularityScore, keywordBoost);
        return {
          entry,
          confidence,
          semanticScore,
          lexicalScore,
          keywordBoost,
          popularityScore,
          source: 'catalog'
        };
      })
      .sort((left, right) => right.confidence - left.confidence);

    const ranked = broadRanked
      .filter((item) => item.confidence >= CANDIDATE_THRESHOLD)
      .filter((item) => item.lexicalScore >= MIN_LEXICAL_SCORE || item.semanticScore >= MATCH_THRESHOLD)
      .slice(0, Math.max(topN, MAX_CANDIDATES));

    const top = ranked[0] || null;
    const relaxedCandidates = broadRanked
      .filter((item) => item.confidence >= SUGGESTION_THRESHOLD)
      .slice(0, Math.max(3, topN));
    const llmFallback = (!top || top.confidence < MATCH_THRESHOLD)
      ? await this.suggestWithLlm(preprocessed, (ranked.length > 0 ? ranked : broadRanked).slice(0, MAX_CANDIDATES), entries)
      : null;

    let createdFallback = null;
    if (llmFallback?.canonicalName) {
      const matchedFallback = professionCatalogService.findBestProfessionMatchSync(llmFallback.canonicalName, entries, { minimumScore: MATCH_THRESHOLD });
      if (matchedFallback) {
        createdFallback = {
          professionId: matchedFallback.id,
          profession: matchedFallback.canonicalName,
          canonicalName: matchedFallback.canonicalName,
          normalizedKey: matchedFallback.normalizedKey,
          confidence: Math.max(llmFallback.confidence, MATCH_THRESHOLD),
          similarity: llmFallback.confidence,
          source: 'llm-matched',
          aliases: matchedFallback.aliases || [],
          tags: matchedFallback.tags || []
        };
      } else if (llmFallback.confidence >= CREATE_THRESHOLD && this.isCanonicalCandidateValid(llmFallback.canonicalName, preprocessed)) {
        const created = await professionCatalogService.createOrUpdateProfession({
          canonicalName: llmFallback.canonicalName,
          aliases: llmFallback.aliases || [],
          tags: llmFallback.tags || [],
          source: 'llm-validated',
          rawInput: preprocessed.raw
        });
        if (created) {
          createdFallback = {
            professionId: created.id,
            profession: created.canonicalName,
            canonicalName: created.canonicalName,
            normalizedKey: created.normalizedKey,
            confidence: llmFallback.confidence,
            similarity: llmFallback.confidence,
            source: 'llm-created',
            aliases: created.aliases || [],
            tags: created.tags || []
          };
        }
      }
    }

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
      ...((ranked.length === 0 ? relaxedCandidates : []).map((item) => ({
        professionId: item.entry.id,
        profession: item.entry.canonicalName,
        canonicalName: item.entry.canonicalName,
        normalizedKey: item.entry.normalizedKey,
        confidence: item.confidence,
        similarity: item.semanticScore,
        source: 'relaxed-catalog',
        aliases: item.entry.aliases || [],
        tags: item.entry.tags || []
      }))),
      ...(createdFallback ? [createdFallback] : [])
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
    const status = bestSuggestion && bestSuggestion.confidence >= CONFIRM_THRESHOLD
      ? 'confirmed'
      : bestSuggestion && bestSuggestion.confidence >= MATCH_THRESHOLD
        ? 'needs_confirmation'
        : bestSuggestion && bestSuggestion.confidence >= SUGGESTION_THRESHOLD
          ? 'needs_confirmation'
        : 'unknown';

    const debugMatches = ranked.slice(0, MAX_CANDIDATES).map((item) => ({
      profession: item.entry.canonicalName,
      semanticScore: Number(item.semanticScore.toFixed(4)),
      lexicalScore: Number(item.lexicalScore.toFixed(4)),
      keywordBoost: Number(item.keywordBoost.toFixed(4)),
      popularityScore: Number(item.popularityScore.toFixed(4)),
      confidence: item.confidence
    }));

    const fallbackDebugMatches = broadRanked.slice(0, MAX_CANDIDATES).map((item) => ({
      profession: item.entry.canonicalName,
      semanticScore: Number(item.semanticScore.toFixed(4)),
      lexicalScore: Number(item.lexicalScore.toFixed(4)),
      keywordBoost: Number(item.keywordBoost.toFixed(4)),
      popularityScore: Number(item.popularityScore.toFixed(4)),
      confidence: item.confidence
    }));

    logger.info('Profession inference debug', {
      context: options.context || 'profession-inference',
      input: preprocessed.raw,
      normalizedInput: preprocessed.normalized,
      topMatches: debugMatches,
      fallbackTopMatches: fallbackDebugMatches,
      llmFallback: llmFallback?.canonicalName || '',
      selectedMatch: bestSuggestion?.canonicalName || '',
      rejectedMatches: fallbackDebugMatches.filter((item) => item.confidence < MATCH_THRESHOLD)
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

  toConfidence(semanticScore = 0, lexicalScore = 0, popularityScore = 0, keywordBoost = 0) {
    const semantic = Math.max(0, Math.min(1, (semanticScore + 1) / 2));
    const lexical = Math.max(0, Math.min(1, lexicalScore));
    const popularity = Math.max(0, Math.min(1, popularityScore));
    const keyword = Math.max(0, Math.min(1, keywordBoost));
    return Number((semantic * 0.58 + lexical * 0.18 + popularity * 0.06 + keyword * 0.18).toFixed(4));
  }

  getKeywordBoost(preprocessed = {}, entry = {}) {
    const normalizedProfession = professionCatalogService.normalizeProfessionKey(entry.canonicalName || entry.name || '');
    const boosters = KEYWORD_BOOSTS[normalizedProfession] || [];
    if (!boosters.length) {
      return 0;
    }

    const haystack = new Set(
      uniqueStrings([
        ...(preprocessed.variants || []),
        preprocessed.embeddingText || '',
        preprocessed.raw || ''
      ])
        .flatMap((value) => String(value || '').toLowerCase().split(/[\s|,/&+-]+/))
        .filter(Boolean)
    );

    const matches = boosters.filter((term) => {
      const normalizedTerm = String(term || '').toLowerCase().trim();
      if (!normalizedTerm) {
        return false;
      }

      const parts = normalizedTerm.split(/\s+/).filter(Boolean);
      return parts.every((part) => haystack.has(part));
    }).length;

    if (!matches) {
      return 0;
    }

    return Math.min(1, 0.22 + (matches * 0.12));
  }

  toPopularityScore(entry = {}) {
    const usageCount = Number(entry.learning?.selectedCount || entry.learning?.usageCount || 0);
    if (!usageCount) {
      return 0;
    }
    return Math.min(1, Math.log10(usageCount + 1) / 2);
  }

  isCanonicalCandidateValid(candidate = '', preprocessed = {}) {
    const cleaned = professionCatalogService.formatProfessionName(candidate);
    const normalizedCandidate = professionCatalogService.normalizeProfessionKey(cleaned);
    const normalizedInput = professionCatalogService.normalizeProfessionKey(preprocessed.raw || '');
    if (!cleaned || !normalizedCandidate) {
      return false;
    }

    if (normalizedCandidate === normalizedInput) {
      return false;
    }

    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 4) {
      return false;
    }

    return !/\b(main|mein|mera|meri|hun|kaam|karta|karti)\b/i.test(cleaned);
  }

  async suggestWithLlm(preprocessed, rankedSuggestions = [], entries = []) {
    const provider = this.getLlmProvider();
    if (!provider) {
      return null;
    }

    const topCandidates = rankedSuggestions.slice(0, MAX_CANDIDATES).map((item) => ({
      profession: item.entry.canonicalName,
      confidence: item.confidence
    }));

    const prompt = [
      'You are validating profession inference for a local-services marketplace.',
      'Input may be Hindi, Hinglish, or English.',
      'Do not echo the raw sentence back as a profession.',
      'Choose the closest profession from candidates if one fits strongly.',
      'If none fits, suggest a short canonical English profession title of at most 4 words.',
      'Return JSON only in this shape:',
      '{"canonicalName":"","aliases":[""],"tags":[""],"confidence":0}',
      `Input: ${JSON.stringify(preprocessed.raw)}`,
      `Normalized: ${JSON.stringify(preprocessed.embeddingText)}`,
      `Top candidates: ${JSON.stringify(topCandidates)}`,
      `Catalog sample: ${JSON.stringify(entries.slice(0, 30).map((entry) => entry.canonicalName))}`
    ].join('\n');

    try {
      if (provider === 'gemini') {
        return await this.askGemini(prompt);
      }
      if (provider === 'ollama') {
        return await this.askOllama(prompt);
      }
    } catch (error) {
      logger.warn(`Profession inference LLM fallback failed: ${error.message}`);
    }

    return null;
  }

  getLlmProvider() {
    if (LLM_PROVIDER === 'gemini' && GEMINI_API_KEY) {
      return 'gemini';
    }
    if (LLM_PROVIDER === 'ollama') {
      return 'ollama';
    }
    if (GEMINI_API_KEY) {
      return 'gemini';
    }
    if (OLLAMA_BASE_URL) {
      return 'ollama';
    }
    return '';
  }

  async askGemini(prompt) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 200,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini request failed with ${response.status}`);
    }

    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('').trim();
    return this.parseJsonResponse(text);
  }

  async askOllama(prompt) {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with ${response.status}`);
    }

    const payload = await response.json();
    return this.parseJsonResponse(payload?.response);
  }

  parseJsonResponse(rawText = '') {
    const text = String(rawText || '').trim();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (_error) {
      const match = text.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    }
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
