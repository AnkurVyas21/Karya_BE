const ACRONYM_TOKENS = new Map([
  ['ac', 'AC'],
  ['seo', 'SEO'],
  ['ui', 'UI'],
  ['ux', 'UX'],
  ['hr', 'HR'],
  ['qa', 'QA'],
  ['it', 'IT'],
  ['ai', 'AI']
]);

const DEVANAGARI_MAP = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ii', 'उ': 'u', 'ऊ': 'uu', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
  'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f', 'य़': 'y',
  'ं': 'n', 'ँ': 'n', 'ः': 'h', '्': '', '़': ''
};

const PHONETIC_EQUIVALENTS = [
  [/\bshaadi\b/g, 'shadi'],
  [/\bshadi\b/g, 'shadi'],
  [/\bmehendi\b/g, 'mehndi'],
  [/\bmehndi\b/g, 'mehndi'],
  [/\bmehandi\b/g, 'mehndi'],
  [/\bbaraat\b/g, 'barat'],
  [/\bbarat\b/g, 'barat'],
  [/\bghori\b/g, 'ghodi'],
  [/\bghodi\b/g, 'ghodi'],
  [/\bsaafa\b/g, 'safa'],
  [/\bsafa\b/g, 'safa'],
  [/\bpanditji\b/g, 'pandit ji'],
  [/\bbyaah\b/g, 'byah'],
  [/\bshaadiyon\b/g, 'shadi'],
  [/\bshaadhi\b/g, 'shadi']
];

class TextNormalizationService {
  normalizeBase(value = '') {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s/&+-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  detectScript(value = '') {
    const text = String(value || '').normalize('NFKC');
    const hasDevanagari = /[\u0900-\u097F]/.test(text);
    const hasLatin = /[a-z]/i.test(text);

    if (hasDevanagari && hasLatin) {
      return 'mixed';
    }
    if (hasDevanagari) {
      return 'devanagari';
    }
    if (hasLatin) {
      return 'latin';
    }

    return 'other';
  }

  transliterateHindiToLatin(value = '') {
    const text = String(value || '').normalize('NFKC');
    let output = '';

    for (const char of text) {
      output += Object.prototype.hasOwnProperty.call(DEVANAGARI_MAP, char)
        ? DEVANAGARI_MAP[char]
        : char;
    }

    return this.normalizeBase(output);
  }

  normalizePhoneticLatin(value = '') {
    let normalized = this.normalizeBase(value);

    PHONETIC_EQUIVALENTS.forEach(([pattern, replacement]) => {
      normalized = normalized.replace(pattern, replacement);
    });

    return normalized
      .replace(/ph/g, 'f')
      .replace(/bh/g, 'b')
      .replace(/kh/g, 'k')
      .replace(/gh/g, 'g')
      .replace(/chh/g, 'ch')
      .replace(/sh/g, 's')
      .replace(/aa/g, 'a')
      .replace(/ii/g, 'i')
      .replace(/ee/g, 'i')
      .replace(/oo/g, 'u')
      .replace(/([a-z])\1+/g, '$1')
      .trim();
  }

  buildVariants(value = '') {
    const original = this.normalizeBase(value);
    const transliterated = this.transliterateHindiToLatin(value);
    const phonetic = this.normalizePhoneticLatin(transliterated || original);

    return [...new Set([original, transliterated, phonetic].filter(Boolean))];
  }

  normalizeProfessionKey(value = '') {
    const transliterated = this.transliterateHindiToLatin(value);
    return this.normalizePhoneticLatin(transliterated || value);
  }

  formatProfessionName(value = '') {
    const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) {
      return '';
    }

    return cleaned
      .split(' ')
      .map((part) => {
        const token = part.trim();
        if (!token) {
          return '';
        }

        const acronym = ACRONYM_TOKENS.get(token.toLowerCase());
        if (acronym) {
          return acronym;
        }

        if (token.includes('/')) {
          return token
            .split('/')
            .map((item) => this.formatProfessionName(item))
            .join('/');
        }

        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
      })
      .join(' ')
      .trim();
  }

  preprocess(value = '') {
    const raw = String(value || '').trim();
    const variants = this.buildVariants(raw);

    return {
      raw,
      normalized: variants[0] || '',
      transliterated: variants[1] || variants[0] || '',
      phonetic: variants[2] || variants[1] || variants[0] || '',
      script: this.detectScript(raw),
      variants,
      embeddingText: variants.join(' | ')
    };
  }
}

module.exports = new TextNormalizationService();
