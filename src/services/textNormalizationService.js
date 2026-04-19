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
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
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

class TextNormalizationService {
  normalizeBase(value = '') {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s/&+-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    return this.normalizeBase(value)
      .replace(/ph/g, 'f')
      .replace(/bh/g, 'b')
      .replace(/kh/g, 'k')
      .replace(/gh/g, 'g')
      .replace(/chh/g, 'ch')
      .replace(/sh/g, 's')
      .replace(/aa/g, 'a')
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
    return this.buildVariants(value)[0] || '';
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
    const variants = this.buildVariants(value);
    return {
      raw: String(value || '').trim(),
      normalized: variants[0] || '',
      transliterated: variants[1] || variants[0] || '',
      phonetic: variants[2] || variants[1] || variants[0] || '',
      variants,
      embeddingText: variants.join(' | ')
    };
  }
}

module.exports = new TextNormalizationService();
