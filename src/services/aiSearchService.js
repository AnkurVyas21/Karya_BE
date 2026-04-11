const logger = require('../utils/logger');
const DEFAULT_PROFESSIONS = require('../constants/professions');
const { PROFESSION_RULES, inferProfessionFromText } = require('../utils/professionInferenceUtils');
const professionCatalogService = require('./professionCatalogService');

const AI_PROVIDERS = {
  GEMINI: 'gemini',
  OLLAMA: 'ollama',
  FALLBACK: 'fallback'
};

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

const normalizeText = (value = '') => String(value || '').trim().toLowerCase();
const normalizeSearchableText = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const compactObject = (value = {}) => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined && item !== null && String(item).trim() !== '')
);
const uniqueStrings = (values = []) => [...new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)];

const KEYWORD_RULES = PROFESSION_RULES.map((rule) => ({
  profession: rule.profession,
  keywords: rule.keywords
}));

class AiSearchService {
  async inferSearch(options = {}) {
    const problem = String(options.problem || '').trim();
    if (!problem) {
      throw new Error('Problem description is required');
    }

    const catalogEntries = this.normalizeCatalogEntries(options.catalogEntries, options.allowedProfessions);
    const selectedLocation = this.normalizeLocation(options.selectedLocation, 'selected-filters');
    const currentLocation = this.normalizeLocation(options.currentLocation, 'current-location');
    const requestedProvider = this.normalizeProvider(options.provider);

    let providerUsed = requestedProvider;
    let warning = '';
    let rawSuggestion = null;

    try {
      if (requestedProvider === AI_PROVIDERS.GEMINI) {
        rawSuggestion = await this.askGemini(problem, catalogEntries, selectedLocation, currentLocation);
      } else if (requestedProvider === AI_PROVIDERS.OLLAMA) {
        rawSuggestion = await this.askOllama(problem, catalogEntries, selectedLocation, currentLocation);
      }
    } catch (error) {
      warning = error.message;
      providerUsed = AI_PROVIDERS.FALLBACK;
      logger.warn(`AI search provider "${requestedProvider}" failed: ${error.message}`);
    }

    if (!rawSuggestion) {
      providerUsed = AI_PROVIDERS.FALLBACK;
      rawSuggestion = this.keywordFallback(problem, catalogEntries, selectedLocation, currentLocation);
      if (!warning && providerUsed !== requestedProvider) {
        warning = `${requestedProvider} is not configured, so built-in matching was used.`;
      }
    }

    const normalized = this.normalizeSuggestion(rawSuggestion, {
      problem,
      catalogEntries,
      selectedLocation,
      currentLocation
    });

    return {
      ...normalized,
      providerRequested: requestedProvider,
      providerUsed,
      usedFallback: providerUsed === AI_PROVIDERS.FALLBACK,
      warning
    };
  }

  normalizeCatalogEntries(catalogEntries, allowedProfessions) {
    const source = Array.isArray(catalogEntries) && catalogEntries.length
      ? catalogEntries
      : (Array.isArray(allowedProfessions) && allowedProfessions.length ? allowedProfessions : DEFAULT_PROFESSIONS)
        .map((name) => ({ name, aliases: [], tags: [] }));

    return source.map((entry) => {
      if (typeof entry === 'string') {
        return {
          name: String(entry).trim(),
          aliases: [],
          tags: []
        };
      }

      return {
        name: String(entry?.name || '').trim(),
        aliases: uniqueStrings(entry?.aliases || []),
        tags: uniqueStrings(entry?.tags || [])
      };
    }).filter((entry) => entry.name);
  }

  normalizeProvider(value) {
    const normalized = normalizeText(value);
    if (normalized === AI_PROVIDERS.OLLAMA) {
      return AI_PROVIDERS.OLLAMA;
    }
    return AI_PROVIDERS.GEMINI;
  }

  normalizeLocation(value = {}, source = 'none') {
    return {
      country: String(value?.country || '').trim(),
      state: String(value?.state || '').trim(),
      city: String(value?.city || '').trim(),
      town: String(value?.town || value?.area || '').trim(),
      source: String(value?.source || source || 'none').trim() || 'none'
    };
  }

  buildPrompt(problem, catalogEntries, selectedLocation, currentLocation) {
    const selectedText = JSON.stringify(compactObject(selectedLocation));
    const currentText = JSON.stringify(compactObject(currentLocation));
    const catalogSummary = catalogEntries
      .slice(0, 150)
      .map((entry) => {
        const aliases = uniqueStrings(entry.aliases || []).slice(0, 6).join(', ');
        const tags = uniqueStrings(entry.tags || []).slice(0, 6).join(', ');
        return `${entry.name}${aliases ? ` | aliases: ${aliases}` : ''}${tags ? ` | tags: ${tags}` : ''}`;
      })
      .join('\n');

    return [
      'You map a user service request into structured search filters for a local-services marketplace.',
      'The user may write in English, Hindi, Hinglish, or a mix of local-language words. Detect the language automatically and infer intent regardless of script.',
      'Choose the closest canonical profession from this catalog. Each line includes the standard English profession plus common aliases and service tags.',
      catalogSummary,
      'If the request mentions a city/state/country/town, use that.',
      'Otherwise prefer currentLocation, then selectedLocation, then keep country empty if nothing is known.',
      'Examples:',
      '- "I need to fix my bathroom tap" -> Plumber',
      '- "bijli wala chahiye for switch repair" -> Electrician',
      '- "wiring repair in indore" -> Electrician',
      'Return JSON only. No markdown, no explanation.',
      'JSON shape:',
      '{"profession":"", "professions":[""], "skills":[""], "country":"", "state":"", "city":"", "town":"", "reason":"", "locationSource":"query|current-location|selected-filters|none"}',
      `selectedLocation=${selectedText}`,
      `currentLocation=${currentText}`,
      `problem=${JSON.stringify(problem)}`
    ].join('\n');
  }

  async askGemini(problem, catalogEntries, selectedLocation, currentLocation) {
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key is missing');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: this.buildPrompt(problem, catalogEntries, selectedLocation, currentLocation) }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 300,
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
    return this.parseModelResponse(text);
  }

  async askOllama(problem, catalogEntries, selectedLocation, currentLocation) {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: this.buildPrompt(problem, catalogEntries, selectedLocation, currentLocation),
        stream: false,
        format: 'json',
        options: {
          temperature: 0.2
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with ${response.status}`);
    }

    const payload = await response.json();
    return this.parseModelResponse(payload?.response);
  }

  parseModelResponse(rawText = '') {
    const text = String(rawText || '').trim();
    if (!text) {
      throw new Error('AI provider returned an empty response');
    }

    try {
      return JSON.parse(text);
    } catch (_error) {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error('AI response was not valid JSON');
      }
      return JSON.parse(match[0]);
    }
  }

  normalizeSuggestion(rawSuggestion = {}, context) {
    const professions = this.normalizeProfessionList(
      rawSuggestion.professions,
      rawSuggestion.profession,
      context.catalogEntries,
      context.problem
    );
    const fallbackLocation = this.pickLocationFallback(rawSuggestion.locationSource, context.selectedLocation, context.currentLocation);
    const country = String(rawSuggestion.country || fallbackLocation.country || '').trim();
    const state = String(rawSuggestion.state || fallbackLocation.state || '').trim();
    const city = String(rawSuggestion.city || fallbackLocation.city || '').trim();
    const town = String(rawSuggestion.town || rawSuggestion.area || fallbackLocation.town || '').trim();
    const matchedProfession = professions[0] || '';
    const locationSource = this.resolveLocationSource(rawSuggestion, {
      selectedLocation: context.selectedLocation,
      currentLocation: context.currentLocation,
      country,
      state,
      city,
      town
    });

    return {
      profession: matchedProfession,
      professions,
      skills: this.normalizeStringList(rawSuggestion.skills),
      country,
      state,
      city,
      town,
      locationSource,
      reason: String(rawSuggestion.reason || '').trim(),
      appliedFilters: compactObject({
        profession: matchedProfession,
        country,
        state,
        city,
        town
      })
    };
  }

  normalizeProfessionList(values, singleValue, catalogEntries, problem = '') {
    const candidates = this.normalizeStringList(values);
    if (singleValue) {
      candidates.unshift(String(singleValue).trim());
    }

    const matched = candidates
      .map((value) => this.matchProfession(value, catalogEntries))
      .filter(Boolean);

    if (matched.length > 0) {
      return [...new Set(matched)];
    }

    const keywordMatches = this.keywordProfessionCandidates(problem, catalogEntries);
    if (keywordMatches.length > 0) {
      return keywordMatches;
    }

    return catalogEntries.length > 0 ? [catalogEntries[0].name] : [];
  }

  normalizeStringList(values) {
    if (Array.isArray(values)) {
      return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
    }

    if (typeof values === 'string') {
      return [...new Set(values.split(',').map((value) => value.trim()).filter(Boolean))];
    }

    return [];
  }

  matchProfession(candidate, catalogEntries) {
    const matchedEntry = professionCatalogService.findBestProfessionMatchSync(candidate, catalogEntries);
    return matchedEntry?.name || '';
  }

  pickLocationFallback(locationSource, selectedLocation, currentLocation) {
    if (locationSource === 'current-location') {
      return currentLocation;
    }
    if (locationSource === 'selected-filters') {
      return selectedLocation;
    }
    return currentLocation.city || currentLocation.state || currentLocation.country
      ? currentLocation
      : selectedLocation;
  }

  resolveLocationSource(rawSuggestion, context) {
    if (String(rawSuggestion.locationSource || '').trim()) {
      return rawSuggestion.locationSource;
    }

    const rawLocationText = [
      rawSuggestion.country,
      rawSuggestion.state,
      rawSuggestion.city,
      rawSuggestion.town,
      rawSuggestion.area
    ].filter(Boolean).join(' ');

    if (rawLocationText) {
      return 'query';
    }

    if (context.currentLocation.city || context.currentLocation.state || context.currentLocation.country) {
      return 'current-location';
    }

    if (context.selectedLocation.city || context.selectedLocation.state || context.selectedLocation.country) {
      return 'selected-filters';
    }

    if (context.country || context.state || context.city || context.town) {
      return 'query';
    }

    return 'none';
  }

  keywordFallback(problem, catalogEntries, selectedLocation, currentLocation) {
    const catalogNames = catalogEntries.map((entry) => entry.name);
    const inferred = inferProfessionFromText(problem, catalogNames);
    const catalogMatches = professionCatalogService.findProfessionMatchesInTextSync(problem, catalogEntries, 3);
    const professionCandidates = inferred.profession
      ? uniqueStrings([inferred.profession, ...(inferred.similarProfessions || [])])
      : uniqueStrings([
          ...catalogMatches.map((entry) => entry.name),
          ...this.keywordProfessionCandidates(problem, catalogEntries)
        ]);
    const extractedLocation = this.extractLocationFromProblem(problem);
    const location = {
      ...(currentLocation.city || currentLocation.state || currentLocation.country ? currentLocation : selectedLocation),
      ...extractedLocation
    };

    return {
      profession: professionCandidates[0] || catalogNames[0] || '',
      professions: professionCandidates,
      country: location.country || '',
      state: location.state || '',
      city: location.city || '',
      town: location.town || '',
      skills: inferred.specializations || [],
      reason: inferred.profession || catalogMatches.length > 0
        ? 'Matched the request with the profession catalog.'
        : 'Matched the request with built-in keyword rules.',
      locationSource: location.city || location.state || location.country ? location.source || 'selected-filters' : 'none'
    };
  }

  keywordProfessionCandidates(problem, catalogEntries) {
    const normalizedProblem = normalizeSearchableText(problem);
    const catalogMatches = professionCatalogService.findProfessionMatchesInTextSync(problem, catalogEntries, 5)
      .map((entry) => entry.name);
    if (!normalizedProblem) {
      return catalogMatches;
    }

    const rankedMatches = KEYWORD_RULES
      .map((rule) => {
        const score = rule.keywords.reduce((total, keyword) => total + this.scoreKeywordMatch(normalizedProblem, keyword), 0);
        return {
          profession: this.matchProfession(rule.profession, catalogEntries),
          score
        };
      })
      .filter((item) => item.profession && item.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((item) => item.profession);

    return uniqueStrings([...catalogMatches, ...rankedMatches]);
  }

  scoreKeywordMatch(problem, keyword) {
    const normalizedKeyword = normalizeSearchableText(keyword);
    if (!problem || !normalizedKeyword) {
      return 0;
    }

    const words = normalizedKeyword.split(' ').filter(Boolean);
    const boundaryPattern = words.length === 1
      ? new RegExp(`(^|\\s)${this.escapeRegex(words[0])}(?=\\s|$)`, 'i')
      : new RegExp(`(^|\\s)${words.map((word) => this.escapeRegex(word)).join('\\s+')}(?=\\s|$)`, 'i');

    if (!boundaryPattern.test(problem)) {
      return 0;
    }

    return words.length >= 2 ? words.length * 4 : (words[0].length <= 3 ? 3 : 2);
  }

  escapeRegex(value = '') {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  extractLocationFromProblem(problem) {
    const match = String(problem || '').match(/\b(?:in|at|near|around)\s+([a-z][a-z\s]{1,40})(?=$|[,.!?])/i);
    if (!match) {
      return {};
    }

    const cleaned = String(match[1] || '')
      .replace(/\b(for|with|who|to|from)\b.*$/i, '')
      .trim()
      .replace(/\s+/g, ' ');

    if (!cleaned) {
      return {};
    }

    const titled = cleaned
      .split(' ')
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');

    return {
      city: titled,
      source: 'query'
    };
  }
}

module.exports = new AiSearchService();
