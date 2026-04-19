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
  '\u0905': 'a', '\u0906': 'aa', '\u0907': 'i', '\u0908': 'ii', '\u0909': 'u', '\u090a': 'uu', '\u090b': 'ri', '\u090f': 'e', '\u0910': 'ai', '\u0913': 'o', '\u0914': 'au',
  '\u093e': 'aa', '\u093f': 'i', '\u0940': 'ii', '\u0941': 'u', '\u0942': 'uu', '\u0943': 'ri', '\u0947': 'e', '\u0948': 'ai', '\u094b': 'o', '\u094c': 'au',
  '\u0915': 'k', '\u0916': 'kh', '\u0917': 'g', '\u0918': 'gh', '\u0919': 'n',
  '\u091a': 'ch', '\u091b': 'chh', '\u091c': 'j', '\u091d': 'jh', '\u091e': 'n',
  '\u091f': 't', '\u0920': 'th', '\u0921': 'd', '\u0922': 'dh', '\u0923': 'n',
  '\u0924': 't', '\u0925': 'th', '\u0926': 'd', '\u0927': 'dh', '\u0928': 'n',
  '\u092a': 'p', '\u092b': 'ph', '\u092c': 'b', '\u092d': 'bh', '\u092e': 'm',
  '\u092f': 'y', '\u0930': 'r', '\u0932': 'l', '\u0935': 'v',
  '\u0936': 'sh', '\u0937': 'sh', '\u0938': 's', '\u0939': 'h',
  '\u0958': 'q', '\u0959': 'kh', '\u095a': 'g', '\u095b': 'z', '\u095c': 'd', '\u095d': 'dh', '\u095e': 'f', '\u095f': 'y',
  '\u0902': 'n', '\u0901': 'n', '\u0903': 'h', '\u094d': '', '\u093c': ''
};

const PHONETIC_EQUIVALENTS = [
  [/\bshaadi\b/g, 'shadi'],
  [/\bshadi\b/g, 'shadi'],
  [/\bshaadiyon\b/g, 'shadi'],
  [/\bshadiyon\b/g, 'shadi'],
  [/\bshaadiyo\b/g, 'shadi'],
  [/\bshadiyo\b/g, 'shadi'],
  [/\bmehendi\b/g, 'mehndi'],
  [/\bmehandi\b/g, 'mehndi'],
  [/\bmehndi\b/g, 'mehndi'],
  [/\bbaraat\b/g, 'barat'],
  [/\bbarat\b/g, 'barat'],
  [/\bbaraaton\b/g, 'barat'],
  [/\bbaraton\b/g, 'barat'],
  [/\bghori\b/g, 'ghodi'],
  [/\bghodi\b/g, 'ghodi'],
  [/\bsaafa\b/g, 'safa'],
  [/\bsafa\b/g, 'safa'],
  [/\bpanditji\b/g, 'pandit ji'],
  [/\bkhane\b/g, 'khana'],
  [/\bkhanae\b/g, 'khana'],
  [/\bkhaney\b/g, 'khana'],
  [/\bbyaah\b/g, 'byah']
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
