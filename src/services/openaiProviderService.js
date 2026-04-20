const OpenAI = require('openai');
const { parseJsonObject } = require('../utils/llmJsonUtils');

const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
const OPENAI_TIMEOUT_MS = Math.max(Number(process.env.OPENAI_TIMEOUT_MS || 15000) || 15000, 1000);

let client = null;

const PROFESSION_CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    profession_name: { type: 'string' },
    alternative_professions: {
      type: 'array',
      items: { type: 'string' }
    },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    confidence: { type: 'number' }
  },
  required: ['profession_name', 'alternative_professions', 'tags', 'confidence']
};

class OpenAiProviderService {
  isConfigured() {
    return Boolean(OPENAI_API_KEY);
  }

  getModel() {
    return OPENAI_MODEL;
  }

  getTimeoutMs() {
    return OPENAI_TIMEOUT_MS;
  }

  getProfessionClassificationSchema() {
    return PROFESSION_CLASSIFICATION_SCHEMA;
  }

  getClient() {
    if (!this.isConfigured()) {
      throw new Error('OpenAI API key is missing');
    }

    if (!client) {
      client = new OpenAI({
        apiKey: OPENAI_API_KEY,
        timeout: OPENAI_TIMEOUT_MS,
        maxRetries: 1
      });
    }

    return client;
  }

  async createStructuredJsonResponse(options = {}) {
    const instructions = String(options.instructions || '').trim();
    const input = String(options.input || '').trim();
    const schemaName = String(options.schemaName || 'structured_output').trim() || 'structured_output';
    const schema = options.schema;
    const maxOutputTokens = Math.max(Number(options.maxOutputTokens) || 250, 1);

    if (!instructions) {
      throw new Error('OpenAI instructions are required');
    }
    if (!input) {
      throw new Error('OpenAI input is required');
    }
    if (!schema || typeof schema !== 'object') {
      throw new Error('OpenAI JSON schema is required');
    }

    try {
      const response = await this.getClient().responses.create({
        model: OPENAI_MODEL,
        instructions,
        input,
        store: false,
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            schema,
            strict: true
          }
        }
      });

      return {
        data: this.extractStructuredJson(response),
        requestId: String(response?._request_id || '').trim()
      };
    } catch (error) {
      const requestId = String(error?.request_id || error?.headers?.['x-request-id'] || '').trim();
      const status = Number(error?.status);
      const statusText = Number.isFinite(status) ? ` (${status})` : '';
      const requestText = requestId ? ` [request_id=${requestId}]` : '';
      throw new Error(`OpenAI request failed${statusText}: ${error.message}${requestText}`);
    }
  }

  extractStructuredJson(response = {}) {
    const outputText = String(response?.output_text || '').trim();
    if (outputText) {
      return parseJsonObject(outputText, { label: 'OpenAI response' });
    }

    const contentItems = Array.isArray(response?.output)
      ? response.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      : [];
    const textParts = contentItems
      .map((item) => {
        if (typeof item?.text === 'string') {
          return item.text;
        }
        if (typeof item?.value === 'string') {
          return item.value;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    if (textParts) {
      return parseJsonObject(textParts, { label: 'OpenAI response' });
    }

    throw new Error('OpenAI response did not include structured text output');
  }
}

module.exports = new OpenAiProviderService();
