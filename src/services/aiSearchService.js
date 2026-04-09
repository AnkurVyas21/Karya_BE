const logger = require('../utils/logger');
const DEFAULT_PROFESSIONS = require('../constants/professions');

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

const KEYWORD_RULES = [
  { profession: 'Plumber', keywords: ['tap', 'leak', 'leakage', 'pipe', 'bathroom', 'sink', 'washbasin', 'faucet', 'flush', 'drain', 'sewer', 'geyser fitting'] },
  { profession: 'Beautician', keywords: ['facial', 'massage', 'salon', 'makeup', 'bridal', 'waxing', 'spa', 'skin care', 'threading', 'pedicure', 'manicure'] },
  { profession: 'Electrician', keywords: ['electric', 'electrical', 'wiring', 'switch', 'socket', 'fan', 'light', 'power', 'mcb', 'short circuit', 'inverter'] },
  { profession: 'AC Repair Technician', keywords: ['ac', 'air conditioner', 'cooling', 'compressor', 'split ac', 'window ac'] },
  { profession: 'Mobile Repair Technician', keywords: ['mobile repair', 'phone repair', 'screen replacement', 'battery replacement', 'smartphone'] },
  { profession: 'Auto Mechanic', keywords: ['car repair', 'bike repair', 'vehicle service', 'garage', 'mechanic', 'engine', 'puncture'] },
  { profession: 'Carpenter', keywords: ['wood', 'furniture', 'carpenter', 'wardrobe', 'cabinet', 'door fitting', 'table repair'] },
  { profession: 'Painter', keywords: ['paint', 'painting', 'wall paint', 'texture', 'putty'] },
  { profession: 'Cleaner', keywords: ['cleaning', 'deep clean', 'sanitize', 'office clean'] },
  { profession: 'House Cleaner', keywords: ['house cleaning', 'home cleaning', 'kitchen clean', 'bathroom clean'] },
  { profession: 'Doctor', keywords: ['doctor', 'medical', 'fever', 'clinic', 'health', 'treatment'] },
  { profession: 'Lawyer', keywords: ['lawyer', 'legal', 'court', 'agreement', 'notice', 'case'] },
  { profession: 'Teacher', keywords: ['tuition', 'teacher', 'tutor', 'coaching', 'homework', 'study'] },
  { profession: 'Home Tutor', keywords: ['home tutor', 'private tutor', 'home tuition'] },
  { profession: 'Photographer', keywords: ['photographer', 'photo shoot', 'wedding photo', 'camera'] },
  { profession: 'Videographer', keywords: ['videographer', 'video shoot', 'reel shoot', 'cinematic'] },
  { profession: 'Caterer', keywords: ['caterer', 'food service', 'party food', 'event food'] },
  { profession: 'Event Planner', keywords: ['event planner', 'wedding planner', 'event management', 'birthday setup'] },
  { profession: 'Web Developer', keywords: ['website', 'web app', 'frontend', 'landing page', 'portfolio site', 'shopify', 'wordpress'] },
  { profession: 'Developer', keywords: ['developer', 'app development', 'software development', 'coding', 'bug fix', 'build app'] },
  { profession: 'Software Engineer', keywords: ['software engineer', 'system design', 'backend', 'api development'] },
  { profession: 'DevOps Engineer', keywords: ['deployment', 'server', 'devops', 'cloud', 'ci/cd', 'docker', 'kubernetes'] },
  { profession: 'Designer', keywords: ['design', 'branding', 'creative', 'mockup'] },
  { profession: 'Graphic Designer', keywords: ['graphic design', 'poster', 'brochure', 'social post', 'logo'] },
  { profession: 'UI/UX Designer', keywords: ['ui', 'ux', 'product design', 'figma', 'wireframe'] },
  { profession: 'Digital Marketer', keywords: ['digital marketing', 'ads', 'campaign', 'meta ads'] },
  { profession: 'SEO Specialist', keywords: ['seo', 'search ranking', 'google ranking', 'organic traffic'] },
  { profession: 'Content Writer', keywords: ['content writing', 'blog writing', 'copywriting', 'article'] },
  { profession: 'Consultant', keywords: ['consult', 'advisor', 'strategy', 'consultant'] }
];

class AiSearchService {
  async inferSearch(options = {}) {
    const problem = String(options.problem || '').trim();
    if (!problem) {
      throw new Error('Problem description is required');
    }

    const allowedProfessions = this.normalizeProfessions(options.allowedProfessions);
    const selectedLocation = this.normalizeLocation(options.selectedLocation, 'selected-filters');
    const currentLocation = this.normalizeLocation(options.currentLocation, 'current-location');
    const requestedProvider = this.normalizeProvider(options.provider);

    let providerUsed = requestedProvider;
    let warning = '';
    let rawSuggestion = null;

    try {
      if (requestedProvider === AI_PROVIDERS.GEMINI) {
        rawSuggestion = await this.askGemini(problem, allowedProfessions, selectedLocation, currentLocation);
      } else if (requestedProvider === AI_PROVIDERS.OLLAMA) {
        rawSuggestion = await this.askOllama(problem, allowedProfessions, selectedLocation, currentLocation);
      }
    } catch (error) {
      warning = error.message;
      providerUsed = AI_PROVIDERS.FALLBACK;
      logger.warn(`AI search provider "${requestedProvider}" failed: ${error.message}`);
    }

    if (!rawSuggestion) {
      providerUsed = AI_PROVIDERS.FALLBACK;
      rawSuggestion = this.keywordFallback(problem, allowedProfessions, selectedLocation, currentLocation);
      if (!warning && providerUsed !== requestedProvider) {
        warning = `${requestedProvider} is not configured, so built-in matching was used.`;
      }
    }

    const normalized = this.normalizeSuggestion(rawSuggestion, {
      problem,
      allowedProfessions,
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

  normalizeProfessions(values) {
    const source = Array.isArray(values) && values.length ? values : DEFAULT_PROFESSIONS;
    return [...new Set(source.map((value) => String(value || '').trim()).filter(Boolean))];
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

  buildPrompt(problem, allowedProfessions, selectedLocation, currentLocation) {
    const selectedText = JSON.stringify(compactObject(selectedLocation));
    const currentText = JSON.stringify(compactObject(currentLocation));
    const professionList = allowedProfessions.join(', ');

    return [
      'You map a user service request into structured search filters for a local-services marketplace.',
      'Choose profession values only from this exact allowed list:',
      professionList,
      'If the problem mentions a city/state/country/town, use that.',
      'Otherwise prefer currentLocation, then selectedLocation, then keep country empty if nothing is known.',
      'Return JSON only. No markdown, no explanation.',
      'JSON shape:',
      '{"profession":"", "professions":[""], "country":"", "state":"", "city":"", "town":"", "skills":[""], "reason":"", "locationSource":"query|current-location|selected-filters|none"}',
      `selectedLocation=${selectedText}`,
      `currentLocation=${currentText}`,
      `problem=${JSON.stringify(problem)}`
    ].join('\n');
  }

  async askGemini(problem, allowedProfessions, selectedLocation, currentLocation) {
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key is missing');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: this.buildPrompt(problem, allowedProfessions, selectedLocation, currentLocation) }] }],
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

  async askOllama(problem, allowedProfessions, selectedLocation, currentLocation) {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: this.buildPrompt(problem, allowedProfessions, selectedLocation, currentLocation),
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
    const professions = this.normalizeProfessionList(rawSuggestion.professions, rawSuggestion.profession, context.allowedProfessions);
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

  normalizeProfessionList(values, singleValue, allowedProfessions) {
    const candidates = this.normalizeStringList(values);
    if (singleValue) {
      candidates.unshift(String(singleValue).trim());
    }

    const matched = candidates
      .map((value) => this.matchProfession(value, allowedProfessions))
      .filter(Boolean);

    if (matched.length > 0) {
      return [...new Set(matched)];
    }

    return this.keywordProfessionCandidates('', allowedProfessions);
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

  matchProfession(candidate, allowedProfessions) {
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedCandidate) {
      return '';
    }

    let bestScore = 0;
    let bestMatch = '';

    allowedProfessions.forEach((profession) => {
      const normalizedProfession = normalizeText(profession);
      if (!normalizedProfession) {
        return;
      }

      let score = 0;
      if (normalizedProfession === normalizedCandidate) {
        score = 100;
      } else if (normalizedProfession.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedProfession)) {
        score = 85;
      } else {
        const candidateTokens = normalizedCandidate.split(/[^a-z0-9]+/).filter(Boolean);
        const professionTokens = normalizedProfession.split(/[^a-z0-9]+/).filter(Boolean);
        score = candidateTokens.reduce((total, token) => total + (professionTokens.includes(token) ? 18 : 0), 0);
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = profession;
      }
    });

    return bestScore >= 18 ? bestMatch : '';
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

  keywordFallback(problem, allowedProfessions, selectedLocation, currentLocation) {
    const professionCandidates = this.keywordProfessionCandidates(problem, allowedProfessions);
    const extractedLocation = this.extractLocationFromProblem(problem);
    const location = {
      ...(currentLocation.city || currentLocation.state || currentLocation.country ? currentLocation : selectedLocation),
      ...extractedLocation
    };

    return {
      profession: professionCandidates[0] || allowedProfessions[0] || '',
      professions: professionCandidates,
      country: location.country || '',
      state: location.state || '',
      city: location.city || '',
      town: location.town || '',
      skills: [],
      reason: 'Matched the request with built-in keyword rules.',
      locationSource: location.city || location.state || location.country ? location.source || 'selected-filters' : 'none'
    };
  }

  keywordProfessionCandidates(problem, allowedProfessions) {
    const normalizedProblem = normalizeText(problem);
    const matches = KEYWORD_RULES
      .filter((rule) => rule.keywords.some((keyword) => normalizedProblem.includes(normalizeText(keyword))))
      .map((rule) => this.matchProfession(rule.profession, allowedProfessions))
      .filter(Boolean);

    if (matches.length > 0) {
      return [...new Set(matches)];
    }

    return [];
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
