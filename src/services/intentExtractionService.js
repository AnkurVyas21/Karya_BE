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
    keywords: ['khana', 'catering', 'caterer', 'halwai', 'food', 'cook', 'rasoi'],
    professions: ['Caterer', 'Halwai']
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

    const prompt = [
      'You are an expert system that identifies professions from user input for an Indian service marketplace.',
      'The input may be in Hindi, Hinglish, or English, and may describe either what the user does or what service the user needs.',
      'Your job is to understand the service being described and map it to practical, real-world profession names commonly used in India.',
      'Use the full meaning of the sentence, not just single keywords. Resolve Hinglish and Hindi phrases to the intended profession.',
      'If the user mentions an activity, role, tool, ceremony, event type, or place of work, infer the most relevant service profession from that context.',
      'If context such as wedding, event, house repair, beauty, childcare, religious ceremony, cooking, music, transport, or cleaning is present, use it to refine the profession suggestions.',
      'Always prefer specific profession titles such as Caterer, Halwai, Pandit, Mehendi Artist, Bridal Mehendi Artist, Barber, Makeup Artist, Electrician, Plumber, Carpenter, Photographer, Videographer, Dhol Player, Wedding Band, Babysitter, Child Care Provider, Tutor, Driver, Cleaner, Cook, Mason, Painter, Tailor, AC Technician.',
      'Do not return generic labels such as worker, helper, person, staff, labour, service provider, or professional.',
      'Do not return unrelated professions.',
      'Always return at least 2 suggested professions.',
      'Never return an empty suggested_professions array.',
      'If you are unsure, make the best reasonable guess based on the described activity and context.',
      'Return JSON only in this exact shape:',
      '{"primary_intent":"","context":"","keywords":[""],"suggested_professions":["",""]}',
      'Requirements for the JSON:',
      '1. primary_intent: short service description in English.',
      '2. context: short context label such as wedding, event, home service, repair, beauty, childcare, religious, transport, or home.',
      '3. keywords: 2 to 8 short keywords derived from the user input and normalized meaning.',
      '4. suggested_professions: at least 2 valid profession names in English.',
      '5. suggested_professions must contain only profession titles, not tasks or sentences.',
      `Catalog sample: ${JSON.stringify(catalogEntries.slice(0, 80).map((entry) => entry.canonicalName))}`,
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
    const matchedRules = INTENT_KEYWORD_RULES.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())));
    const inferredCatalogProfessions = professionCatalogService.findProfessionMatchesInTextSync(preprocessed.raw, catalogEntries, 5)
      .map((entry) => entry.canonicalName);
    const professions = uniqueStrings([
      ...matchedRules.flatMap((rule) => rule.professions),
      ...inferredCatalogProfessions
    ]);

    return {
      primary_intent: matchedRules[0]?.intent || (professions[0] ? `${professions[0]} service` : ''),
      context: matchedRules[0]?.context || this.detectContext(text),
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
    const llmProfessions = uniqueStrings(llmResult?.suggested_professions || llmResult?.suggestedProfessions || []);
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
      primary_intent: String(llmResult?.primary_intent || llmResult?.primaryIntent || fallbackResult.primary_intent || '').trim(),
      context: String(llmResult?.context || fallbackResult.context || '').trim(),
      keywords: uniqueStrings([
        ...(llmResult?.keywords || []),
        ...(fallbackResult.keywords || [])
      ]).slice(0, 8),
      suggested_professions: suggestedProfessions,
      providerUsed: llmResult ? this.getProvider() : fallbackResult.providerUsed,
      usedFallback: !llmResult || fallbackResult.usedFallback
    };
  }

  detectContext(text = '') {
    if (/\b(shaadi|shadi|wedding|marriage|bridal|baraat)\b/.test(text)) {
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
