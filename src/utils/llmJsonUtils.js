const stripMarkdownFences = (value = '') => String(value || '')
  .trim()
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/\s*```$/i, '')
  .trim();

const extractFirstJsonObject = (value = '') => {
  const text = stripMarkdownFences(value);
  const start = text.indexOf('{');
  if (start === -1) {
    return '';
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return '';
};

const parseJsonObject = (rawText = '', options = {}) => {
  const label = String(options.label || 'LLM response').trim() || 'LLM response';
  const text = stripMarkdownFences(rawText);
  if (!text) {
    throw new Error(`${label} was empty`);
  }

  const directCandidate = text.startsWith('{') && text.endsWith('}') ? text : '';
  const candidate = directCandidate || extractFirstJsonObject(text);
  if (!candidate) {
    throw new Error(`${label} did not contain a valid JSON object`);
  }

  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed;
  } catch (_error) {
    throw new Error(`${label} contained malformed JSON`);
  }
};

const normalizeStringArray = (value = []) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )];
};

const normalizeConfidence = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(1, parsed));
};

const validateProfessionClassification = (rawValue = {}) => {
  if (!rawValue || Array.isArray(rawValue) || typeof rawValue !== 'object') {
    throw new Error('Profession classification must be a JSON object');
  }

  const profession_name = String(rawValue.profession_name || '').trim();
  const tags = normalizeStringArray(rawValue.tags);
  const confidence = normalizeConfidence(rawValue.confidence);

  if (!Object.prototype.hasOwnProperty.call(rawValue, 'profession_name')) {
    throw new Error('Profession classification is missing profession_name');
  }
  if (!Object.prototype.hasOwnProperty.call(rawValue, 'tags')) {
    throw new Error('Profession classification is missing tags');
  }
  if (!Object.prototype.hasOwnProperty.call(rawValue, 'confidence')) {
    throw new Error('Profession classification is missing confidence');
  }

  return {
    profession_name,
    tags,
    confidence
  };
};

module.exports = {
  stripMarkdownFences,
  extractFirstJsonObject,
  parseJsonObject,
  normalizeStringArray,
  normalizeConfidence,
  validateProfessionClassification
};
