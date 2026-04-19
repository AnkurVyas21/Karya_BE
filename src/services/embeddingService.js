const crypto = require('crypto');
const textNormalizationService = require('./textNormalizationService');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || process.env.OLLAMA_MODEL || 'nomic-embed-text';
const DEFAULT_PROVIDER = String(process.env.PROFESSION_EMBEDDING_PROVIDER || '').trim().toLowerCase()
  || (GEMINI_API_KEY ? 'gemini' : 'local');

class EmbeddingService {
  constructor() {
    this.cache = new Map();
  }

  getProvider() {
    return DEFAULT_PROVIDER;
  }

  getModelName() {
    if (this.getProvider() === 'gemini') {
      return GEMINI_EMBEDDING_MODEL;
    }
    if (this.getProvider() === 'ollama') {
      return OLLAMA_EMBEDDING_MODEL;
    }
    return 'local-hash-embedding';
  }

  checksum(value = '') {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex');
  }

  async embedText(value = '') {
    const normalized = textNormalizationService.preprocess(value).embeddingText;
    const key = `${this.getProvider()}:${this.getModelName()}:${this.checksum(normalized)}`;
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    let vector;
    if (this.getProvider() === 'gemini') {
      try {
        vector = await this.embedWithGemini(normalized);
      } catch (_error) {
        vector = this.localEmbed(normalized);
      }
    } else if (this.getProvider() === 'ollama') {
      try {
        vector = await this.embedWithOllama(normalized);
      } catch (_error) {
        vector = this.localEmbed(normalized);
      }
    } else {
      vector = this.localEmbed(normalized);
    }

    this.cache.set(key, vector);
    return vector;
  }

  async embedWithGemini(text) {
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini embedding key is missing');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_EMBEDDING_MODEL)}:embedContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${GEMINI_EMBEDDING_MODEL}`,
          content: {
            parts: [{ text }]
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini embedding request failed with ${response.status}`);
    }

    const payload = await response.json();
    return this.normalizeVector(payload?.embedding?.values || []);
  }

  async embedWithOllama(text) {
    const embedResponse = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_EMBEDDING_MODEL,
        input: text
      })
    });

    if (embedResponse.ok) {
      const payload = await embedResponse.json();
      return this.normalizeVector(payload?.embeddings?.[0] || []);
    }

    const legacyResponse = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_EMBEDDING_MODEL,
        prompt: text
      })
    });

    if (!legacyResponse.ok) {
      throw new Error(`Ollama embedding request failed with ${legacyResponse.status}`);
    }

    const payload = await legacyResponse.json();
    return this.normalizeVector(payload?.embedding || []);
  }

  localEmbed(text = '') {
    const normalized = textNormalizationService.preprocess(text).embeddingText;
    const dimensions = 192;
    const vector = new Array(dimensions).fill(0);
    const grams = [];
    const source = `  ${normalized}  `;

    for (let index = 0; index < source.length - 2; index += 1) {
      grams.push(source.slice(index, index + 3));
    }

    grams.forEach((gram) => {
      const hash = crypto.createHash('md5').update(gram).digest();
      const bucket = hash.readUInt16BE(0) % dimensions;
      const sign = (hash[2] % 2 === 0) ? 1 : -1;
      vector[bucket] += sign;
    });

    return this.normalizeVector(vector);
  }

  normalizeVector(vector = []) {
    const values = Array.isArray(vector) ? vector.map((value) => Number(value) || 0) : [];
    const magnitude = Math.sqrt(values.reduce((total, value) => total + (value * value), 0));
    if (!magnitude) {
      return values;
    }

    return values.map((value) => value / magnitude);
  }

  cosineSimilarity(left = [], right = []) {
    if (!left.length || !right.length || left.length !== right.length) {
      return 0;
    }

    return left.reduce((total, value, index) => total + (value * right[index]), 0);
  }
}

module.exports = new EmbeddingService();
