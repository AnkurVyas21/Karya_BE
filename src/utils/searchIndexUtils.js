const textNormalizationService = require('../services/textNormalizationService');

const SEARCH_TOKEN_STOPWORDS = new Set([
  'a', 'an', 'and', 'aur', 'are', 'at', 'be', 'by', 'can', 'for', 'from', 'hai',
  'he', 'i', 'in', 'is', 'ke', 'ki', 'ko', 'liye', 'me', 'mein', 'my', 'near',
  'of', 'on', 'or', 'service', 'services', 'the', 'to', 'with', 'you', 'your'
]);

const uniqueStrings = (values = []) => {
  const seen = new Set();
  const output = [];

  values.forEach((value) => {
    const cleaned = String(value || '').trim();
    if (!cleaned || seen.has(cleaned)) {
      return;
    }
    seen.add(cleaned);
    output.push(cleaned);
  });

  return output;
};

const normalizeSearchKey = (value = '') => textNormalizationService.normalizeProfessionKey(value);

const normalizeList = (value) => {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }

  if (typeof value === 'string') {
    return uniqueStrings(value.split(','));
  }

  return [];
};

const normalizeKeyList = (values = []) => uniqueStrings(
  values
    .flatMap((value) => normalizeList(value))
    .map((value) => normalizeSearchKey(value))
    .filter(Boolean)
);

const tokenizeSearchText = (values = []) => {
  const normalized = normalizeSearchKey(values.flatMap((value) => normalizeList(value)).join(' '));
  if (!normalized) {
    return [];
  }

  return uniqueStrings(
    normalized
      .split(/[\s,/&+-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !SEARCH_TOKEN_STOPWORDS.has(token))
  ).slice(0, 120);
};

const buildProfileSearchIndex = (profile = {}) => {
  const profession = String(profile.profession || '').trim();
  const skills = normalizeList(profile.skills || []);
  const tags = normalizeList(profile.tags || []);
  const serviceAreas = normalizeList(profile.serviceAreas || []);
  const country = String(profile.country || 'India').trim() || 'India';
  const state = String(profile.state || '').trim();
  const city = String(profile.city || '').trim();
  const town = String(profile.town || '').trim();
  const area = String(profile.area || '').trim();
  const location = String(profile.location || '').trim();
  const description = String(profile.description || '').trim();

  const professionKeys = normalizeKeyList([profession, skills, tags]);
  const locationKeys = normalizeKeyList([country, state, city, town, area, location, serviceAreas]);
  const searchTokens = tokenizeSearchText([
    profession,
    skills,
    tags,
    description,
    country,
    state,
    city,
    town,
    area,
    location,
    serviceAreas
  ]);

  return {
    professionKey: normalizeSearchKey(profession),
    professionKeys,
    skillKeys: normalizeKeyList(skills),
    tagKeys: normalizeKeyList(tags),
    countryKey: normalizeSearchKey(country),
    stateKey: normalizeSearchKey(state),
    cityKey: normalizeSearchKey(city),
    townKey: normalizeSearchKey(town),
    areaKey: normalizeSearchKey(area),
    locationKeys,
    serviceAreaKeys: normalizeKeyList(serviceAreas),
    searchTokens,
    searchableText: normalizeSearchKey([
      profession,
      skills.join(' '),
      tags.join(' '),
      description,
      country,
      state,
      city,
      town,
      area,
      location,
      serviceAreas.join(' ')
    ].filter(Boolean).join(' '))
  };
};

module.exports = {
  buildProfileSearchIndex,
  normalizeSearchKey,
  tokenizeSearchText,
  uniqueStrings
};
