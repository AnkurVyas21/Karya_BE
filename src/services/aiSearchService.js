const logger = require('../utils/logger');
const professionInferenceService = require('./professionInferenceService');

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
const compactObject = (value = {}) => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined && item !== null && String(item).trim() !== '')
);
const uniqueStrings = (values = []) => [...new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)];

class AiSearchService {
  async inferSearch(options = {}) {
    const problem = String(options.problem || '').trim();
    if (!problem) {
      throw new Error('Problem description is required');
    }

    const selectedLocation = this.normalizeLocation(options.selectedLocation, 'selected-filters');
    const currentLocation = this.normalizeLocation(options.currentLocation, 'current-location');
    const requestedProvider = this.normalizeProvider(options.provider);

    const professionInference = await professionInferenceService.inferProfession(problem, {
      context: 'search-ai',
      log: false,
      topN: 5,
      allowedProfessionNames: Array.isArray(options.allowedProfessions) ? options.allowedProfessions : []
    });

    let providerUsed = requestedProvider;
    let warning = '';
    let locationSuggestion = null;

    try {
      if (requestedProvider === AI_PROVIDERS.GEMINI) {
        locationSuggestion = await this.askGemini(problem, professionInference, selectedLocation, currentLocation);
      } else if (requestedProvider === AI_PROVIDERS.OLLAMA) {
        locationSuggestion = await this.askOllama(problem, professionInference, selectedLocation, currentLocation);
      }
    } catch (error) {
      warning = error.message;
      providerUsed = AI_PROVIDERS.FALLBACK;
      logger.warn(`AI search provider "${requestedProvider}" failed: ${error.message}`);
    }

    if (!locationSuggestion) {
      providerUsed = AI_PROVIDERS.FALLBACK;
      locationSuggestion = this.locationFallback(problem, selectedLocation, currentLocation);
      if (!warning && providerUsed !== requestedProvider) {
        warning = `${requestedProvider} is not configured, so built-in location matching was used.`;
      }
    }

    const normalized = this.normalizeSuggestion(locationSuggestion, {
      professionInference,
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

  buildPrompt(problem, professionInference, selectedLocation, currentLocation) {
    return [
      'You extract only location filters for a local-services marketplace.',
      'The profession candidates are already inferred semantically and should be copied from the provided suggestions.',
      `Suggested professions: ${JSON.stringify(uniqueStrings([professionInference.suggestedProfession, ...(professionInference.similarProfessions || [])]))}`,
      'Return JSON only.',
      '{"country":"", "state":"", "city":"", "town":"", "reason":"", "locationSource":"query|current-location|selected-filters|none"}',
      `selectedLocation=${JSON.stringify(compactObject(selectedLocation))}`,
      `currentLocation=${JSON.stringify(compactObject(currentLocation))}`,
      `problem=${JSON.stringify(problem)}`
    ].join('\n');
  }

  async askGemini(problem, professionInference, selectedLocation, currentLocation) {
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key is missing');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: this.buildPrompt(problem, professionInference, selectedLocation, currentLocation) }] }],
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
    return this.parseModelResponse(text);
  }

  async askOllama(problem, professionInference, selectedLocation, currentLocation) {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: this.buildPrompt(problem, professionInference, selectedLocation, currentLocation),
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

  locationFallback(problem, selectedLocation, currentLocation) {
    const extractedLocation = this.extractLocationFromProblem(problem);
    return {
      ...(currentLocation.city || currentLocation.state || currentLocation.country ? currentLocation : selectedLocation),
      ...extractedLocation,
      reason: extractedLocation.city || extractedLocation.state || extractedLocation.country
        ? 'Extracted location directly from the query.'
        : 'Used the selected/current location because the query did not include a clear place.',
      locationSource: extractedLocation.city || extractedLocation.state || extractedLocation.country
        ? 'query'
        : ((currentLocation.city || currentLocation.state || currentLocation.country) ? 'current-location' : 'selected-filters')
    };
  }

  normalizeSuggestion(rawSuggestion = {}, context = {}) {
    const inferredProfessions = uniqueStrings([
      context.professionInference?.suggestedProfession || '',
      ...(context.professionInference?.similarProfessions || [])
    ]);
    const contextSuggestions = uniqueStrings(context.professionInference?.contextSuggestions || []);
    const fallbackLocation = this.pickLocationFallback(rawSuggestion.locationSource, context.selectedLocation, context.currentLocation);
    const country = String(rawSuggestion.country || fallbackLocation.country || '').trim();
    const state = String(rawSuggestion.state || fallbackLocation.state || '').trim();
    const city = String(rawSuggestion.city || fallbackLocation.city || '').trim();
    const town = String(rawSuggestion.town || rawSuggestion.area || fallbackLocation.town || '').trim();
    const matchedProfession = inferredProfessions[0] || '';

    return {
      profession: matchedProfession,
      professions: inferredProfessions,
      contextSuggestions,
      skills: context.professionInference?.specializations || [],
      country,
      state,
      city,
      town,
      locationSource: this.resolveLocationSource(rawSuggestion, {
        selectedLocation: context.selectedLocation,
        currentLocation: context.currentLocation,
        country,
        state,
        city,
        town
      }),
      reason: String(rawSuggestion.reason || 'Applied semantic profession inference and location extraction.').trim(),
      intent: context.professionInference?.intent || null,
      appliedFilters: compactObject({
        profession: matchedProfession,
        country,
        state,
        city,
        town
      })
    };
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

    return 'none';
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
