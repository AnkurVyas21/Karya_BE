const logger = require('../utils/logger');
const professionCatalogService = require('./professionCatalogService');
const textNormalizationService = require('./textNormalizationService');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const INTENT_PROVIDER = String(process.env.INTENT_LLM_PROVIDER || process.env.PROFESSION_LLM_PROVIDER || '').trim().toLowerCase();

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

const INTENT_KEYWORD_RULES = [
  {
    intent: 'cooking service',
    context: 'wedding',
    keywords: ['khana', 'catering', 'caterer', 'halwai', 'food', 'cook', 'rasoi', 'order'],
    professions: ['Wedding Caterer', 'Caterer', 'Halwai']
  },
  {
    intent: 'mehendi service',
    context: 'wedding',
    keywords: ['mehndi', 'mehendi', 'henna', 'bridal mehendi'],
    professions: ['Mehendi Artist']
  },
  {
    intent: 'child care service',
    context: 'childcare',
    keywords: ['child care', 'childcare', 'baby care', 'nanny', 'kids care', 'baccha', 'bache', 'children'],
    professions: ['Child Care Provider', 'Home Tutor', 'Teacher']
  },
  {
    intent: 'photography service',
    context: 'event',
    keywords: ['photo', 'photography', 'camera', 'photoshoot'],
    professions: ['Photographer']
  },
  {
    intent: 'home cleaning service',
    context: 'home',
    keywords: ['cleaning', 'cleaner', 'house cleaning', 'safai'],
    professions: ['Cleaner', 'House Cleaner']
  },
  {
    intent: 'electrical repair service',
    context: 'repair',
    keywords: ['electrician', 'bijli', 'wiring', 'switch', 'light'],
    professions: ['Electrician']
  },
  {
    intent: 'plumbing service',
    context: 'repair',
    keywords: ['plumber', 'pipe', 'tap', 'leak', 'nal', 'bathroom'],
    professions: ['Plumber']
  }
];

const CONTEXT_HINT_TERMS = {
  wedding: ['wedding', 'marriage', 'shadi', 'barat', 'bridal', 'mehndi', 'pandit', 'ghodi', 'safa', 'band', 'tent', 'decor'],
  childcare: ['child', 'childcare', 'baby', 'kids', 'nanny', 'baccha', 'bache'],
  home: ['home', 'house', 'ghar', 'room', 'kitchen', 'bathroom'],
  repair: ['repair', 'fix', 'service', 'leak', 'wiring', 'pipe', 'board', 'electric', 'plumbing'],
  beauty: ['beauty', 'makeup', 'parlour', 'mehndi', 'bridal']
};

class IntentExtractionService {
  async extractIntent(rawInput = '', options = {}) {
    const preprocessed = textNormalizationService.preprocess(rawInput);
    if (!preprocessed.raw) {
      throw new Error('Input is required');
    }

    const catalogEntries = Array.isArray(options.professionCatalogEntries) && options.professionCatalogEntries.length > 0
      ? options.professionCatalogEntries
      : await professionCatalogService.getAllProfessionEntries();
    const llmResult = options.skipLlm ? null : await this.extractWithLlm(preprocessed, catalogEntries);
    const fallbackResult = this.extractWithKeywords(preprocessed, catalogEntries);
    const resolved = this.mergeIntentResults(preprocessed, llmResult, fallbackResult, catalogEntries, options);

    logger.info('Intent extraction debug', {
      context: options.context || 'intent-extraction',
      input: preprocessed.raw,
      normalizedInput: preprocessed.normalized,
      providerUsed: resolved.providerUsed,
      usedFallback: resolved.usedFallback,
      intentOutput: {
        primary_intent: resolved.primary_intent,
        context: resolved.context,
        keywords: resolved.keywords,
        suggested_professions: resolved.suggested_professions
      }
    });

    return resolved;
  }

  async extractWithLlm(preprocessed, catalogEntries = []) {
    const provider = this.getProvider();
    if (!provider) {
      return null;
    }

    const catalogSummary = catalogEntries
      .slice(0, 120)
      .map((entry) => ({
        name: entry.canonicalName,
        aliases: (entry.aliases || []).slice(0, 8),
        tags: (entry.tags || []).slice(0, 8)
      }));
    const prompt = [
      'You are a strict classifier for an India-only local professional finder.',
      'Input may be Hindi, Hinglish, English, or mixed.',
      'Understand the service semantically, not only by exact phrase match.',
      'Choose exactly one main category from the supplied catalog whenever possible.',
      'If no supplied category is a close match, return a short English profession_name inferred from the work described.',
      'Do not hallucinate random categories or generic labels.',
      'Return JSON only in this exact shape:',
      '{"profession_name":"","tags":[],"confidence":0,"language":"","city":""}',
      'Rules:',
      '1. If a supplied catalog category clearly fits, profession_name must be exactly that category name.',
      '2. If no supplied category clearly fits, profession_name may be a short English profession title inferred from the sentence.',
      '3. Only one main profession_name is allowed.',
      '4. If confidence is below 0.75, profession_name should be empty.',
      '5. tags should contain short normalized meaning words, not full sentences.',
      '6. city must be extracted only if clearly present in the user input.',
      `Catalog: ${JSON.stringify(catalogSummary)}`,
      `Input: ${JSON.stringify(preprocessed.raw)}`,
      `Normalized: ${JSON.stringify(preprocessed.embeddingText)}`
    ].join('\n');

    try {
      if (provider === 'gemini') {
        return await this.askGemini(prompt);
      }
      if (provider === 'ollama') {
        return await this.askOllama(prompt);
      }
    } catch (error) {
      logger.warn(`Intent extraction LLM failed: ${error.message}`);
    }

    return null;
  }

  extractWithKeywords(preprocessed, catalogEntries = []) {
    const text = String(preprocessed.embeddingText || preprocessed.raw || '').toLowerCase();
    const detectedContext = this.detectContext(text);
    const matchedRules = INTENT_KEYWORD_RULES.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())));
    const inferredCatalogProfessions = professionCatalogService.findProfessionMatchesInTextSync(preprocessed.raw, catalogEntries, 5)
      .map((entry) => entry.canonicalName);
    const semanticCatalogProfessions = this.findSemanticCatalogMatches(preprocessed, catalogEntries, detectedContext)
      .map((entry) => entry.canonicalName);
    const professions = uniqueStrings([
      ...semanticCatalogProfessions,
      ...matchedRules.flatMap((rule) => rule.professions),
      ...inferredCatalogProfessions
    ]);

    return {
      primary_intent: matchedRules[0]?.intent || (professions[0] ? `${professions[0]} service` : ''),
      context: matchedRules[0]?.context || detectedContext,
      keywords: uniqueStrings([
        ...matchedRules.flatMap((rule) => rule.keywords),
        ...text.split(/[\s|,/&+-]+/).filter((token) => token.length > 2)
      ]).slice(0, 8),
      suggested_professions: professions,
      providerUsed: 'keyword-fallback',
      usedFallback: true
    };
  }

  mergeIntentResults(preprocessed, llmResult, fallbackResult, catalogEntries = [], options = {}) {
    const llmProfessions = uniqueStrings([
      llmResult?.profession_name || '',
      llmResult?.normalized_category || '',
      ...(llmResult?.suggested_professions || []),
      ...(llmResult?.suggestedProfessions || [])
    ]);
    const fallbackProfessions = uniqueStrings(fallbackResult?.suggested_professions || []);
    const catalogMatches = professionCatalogService.findProfessionMatchesInTextSync(preprocessed.raw, catalogEntries, 5)
      .map((entry) => entry.canonicalName);
    const allowedNames = Array.isArray(options.allowedProfessionNames) && options.allowedProfessionNames.length > 0
      ? new Set(options.allowedProfessionNames.map((item) => textNormalizationService.normalizeProfessionKey(item)).filter(Boolean))
      : null;

    const suggestedProfessions = uniqueStrings([
      ...llmProfessions,
      ...fallbackProfessions,
      ...catalogMatches
    ]).filter((profession) => {
      if (!allowedNames) {
        return true;
      }
      return allowedNames.has(textNormalizationService.normalizeProfessionKey(profession));
    });

    return {
      primary_intent: String(llmResult?.profession_name || llmResult?.intent || llmResult?.primary_intent || llmResult?.primaryIntent || fallbackResult.primary_intent || '').trim(),
      context: String(llmResult?.language || llmResult?.context || fallbackResult.context || '').trim(),
      keywords: uniqueStrings([
        ...(llmResult?.tags || []),
        ...(llmResult?.keywords || []),
        ...(fallbackResult.keywords || [])
      ]).slice(0, 8),
      suggested_professions: suggestedProfessions,
      providerUsed: llmResult ? this.getProvider() : fallbackResult.providerUsed,
      usedFallback: !llmResult || fallbackResult.usedFallback
    };
  }

  detectContext(text = '') {
    if (/\b(shaadi|shadi|shadiyon|wedding|marriage|bridal|baraat|barat)\b/.test(text)) {
      return 'wedding';
    }
    if (/\b(child|childcare|baby|kids|nanny|baccha|bache)\b/.test(text)) {
      return 'childcare';
    }
    if (/\b(home|house|ghar)\b/.test(text)) {
      return 'home';
    }
    if (/\b(event|function|party)\b/.test(text)) {
      return 'event';
    }
    return '';
  }

  findSemanticCatalogMatches(preprocessed, catalogEntries = [], detectedContext = '', limit = 5) {
    const variantsText = uniqueStrings(preprocessed.variants || []).join(' | ');
    const queryTokens = new Set(
      uniqueStrings(variantsText.split(/[\s|,/&+-]+/).filter((token) => token.length > 1))
        .map((token) => textNormalizationService.normalizeProfessionKey(token))
        .filter(Boolean)
    );

    return catalogEntries
      .map((entry) => {
        const terms = professionCatalogService.getSearchTerms(entry);
        const bestSimilarity = Math.max(
          ...terms.map((term) => professionCatalogService.stringSimilarity(variantsText, term)),
          0
        );

        const overlapScore = Math.max(
          ...terms.map((term) => {
            const termTokens = new Set(
              textNormalizationService.buildVariants(term)
                .join(' ')
                .split(/\s+/)
                .map((token) => textNormalizationService.normalizeProfessionKey(token))
                .filter(Boolean)
            );

            if (!termTokens.size) {
              return 0;
            }

            const overlap = [...termTokens].filter((token) => queryTokens.has(token)).length;
            return overlap / termTokens.size;
          }),
          0
        );

        let score = (bestSimilarity * 0.68) + (overlapScore * 0.32);
        if (detectedContext && this.entryMatchesContext(entry, detectedContext)) {
          score += 0.18;
        }
        if (
          (queryTokens.has('khana') || queryTokens.has('food') || queryTokens.has('cook') || queryTokens.has('order'))
          && this.entryHasFoodSignals(entry)
        ) {
          score += 0.12;
        }

        return { entry, score };
      })
      .filter((item) => item.score >= 0.34)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((item) => item.entry);
  }

  entryMatchesContext(entry = {}, context = '') {
    const hintTerms = CONTEXT_HINT_TERMS[context] || [];
    if (hintTerms.length === 0) {
      return false;
    }

    const searchable = textNormalizationService.normalizeProfessionKey(
      professionCatalogService.getSearchTerms(entry).join(' ')
    );

    return hintTerms.some((term) => searchable.includes(textNormalizationService.normalizeProfessionKey(term)));
  }

  entryHasFoodSignals(entry = {}) {
    const searchable = textNormalizationService.normalizeProfessionKey(
      professionCatalogService.getSearchTerms(entry).join(' ')
    );
    return /\bcater|food|cook|khana|halwai|meal\b/.test(searchable);
  }

  getProvider() {
    if (INTENT_PROVIDER === 'gemini' && GEMINI_API_KEY) {
      return 'gemini';
    }
    if (INTENT_PROVIDER === 'ollama') {
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
            maxOutputTokens: 250,
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
    return this.parseJson(text);
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
    return this.parseJson(payload?.response);
  }

  parseJson(rawText = '') {
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
}

module.exports = new IntentExtractionService();
