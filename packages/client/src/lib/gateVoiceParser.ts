import { tokenToDigits, type DictationLang } from './useDictation';

// ─── Types ─────────────────────────────────────────────────────────
export type ParsedVisitor = {
  name: string;
  mobile: string;
  purpose: string | null;
};

export type ParsedDelivery = {
  name: string;
  mobile: string;
  deliveryType: string | null;
};

// ─── Purpose / delivery-type synonyms (en / ta / hi) ───────────────
// Each canonical value maps to spoken keywords across the three languages.
const PURPOSE_SYNONYMS: Record<string, string[]> = {
  Guest: ['guest', 'visitor', 'விருந்தினர்', 'அதிதி', 'मेहमान', 'अतिथि', 'गेस्ट'],
  'Family Visit': ['family', 'relative', 'குடும்பம்', 'உறவினர்', 'परिवार', 'रिश्तेदार', 'फैमिली'],
  'Friend Visit': ['friend', 'நண்பர்', 'दोस्त', 'मित्र', 'फ्रेंड'],
  Maintenance: [
    'maintenance', 'repair', 'plumber', 'electrician', 'service', 'serviceman', 'technician',
    'பராமரிப்பு', 'பழுது', 'பிளம்பர்', 'எலக்ட்ரீஷியன்', 'மெக்கானிக்',
    'मरम्मत', 'रिपेयर', 'प्लंबर', 'इलेक्ट्रीशियन', 'मैकेनिक', 'मेंटेनेंस',
  ],
  Official: [
    'official', 'office', 'work', 'business', 'meeting', 'delivery agent', 'company',
    'அலுவல்', 'அதிகாரி', 'வேலை', 'அலுவலகம்',
    'ऑफिशियल', 'अधिकारी', 'काम', 'दफ्तर', 'ऑफिस', 'मीटिंग',
  ],
  Other: ['other', 'others', 'மற்றவை', 'अन्य', 'दूसरा'],
};

const DELIVERY_SYNONYMS: Record<string, string[]> = {
  COURIER: ['courier', 'parcel agent', 'dtdc', 'bluedart', 'delhivery', 'காரியர்', 'कूरियर'],
  FOOD: ['food', 'swiggy', 'zomato', 'meal', 'restaurant', 'உணவு', 'சாப்பாடு', 'खाना', 'फूड', 'भोजन'],
  GROCERY: ['grocery', 'groceries', 'bigbasket', 'blinkit', 'zepto', 'vegetables', 'மளிகை', 'காய்கறி', 'किराना', 'ग्रोसरी', 'सब्जी'],
  MEDICINE: ['medicine', 'pharmacy', 'medical', 'pharmeasy', 'apollo', 'மருந்து', 'दवा', 'दवाई', 'मेडिसिन'],
  PARCEL: ['parcel', 'package', 'amazon', 'flipkart', 'shipment', 'பார்சல்', 'பொட்டலம்', 'पार्सल', 'पैकेज'],
  OTHER: ['other', 'others', 'மற்றவை', 'अन्य'],
};

// Filler / connector words to drop from the leftover name across languages.
const STOP_WORDS = new Set([
  // English
  'and', 'the', 'a', 'an', 'is', 'my', 'name', 'mobile', 'number', 'phone', 'purpose',
  'for', 'to', 'of', 'mr', 'mrs', 'miss', 'this', 'here', 'visiting', 'coming', 'from',
  'i', 'am', 'he', 'she', 'they', 'his', 'her',
  // Tamil
  'பெயர்', 'மொபைல்', 'நம்பர்', 'எண்', 'நோக்கம்', 'வந்துள்ளார்', 'வந்தார்', 'திரு',
  // Hindi
  'नाम', 'मोबाइल', 'नंबर', 'फोन', 'उद्देश्य', 'काम', 'के', 'लिए', 'का', 'है', 'श्री', 'जी',
]);

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[.,!?;:"']/g, '').trim();
}

/**
 * Find a canonical category by matching transcript tokens against a synonym map.
 * Returns the canonical key (e.g. "Maintenance" / "FOOD") or null.
 */
function matchCategory(rawTokens: string[], synonyms: Record<string, string[]>): {
  key: string | null;
  matchedTokens: Set<number>;
} {
  const matchedTokens = new Set<number>();
  const joined = rawTokens.map(normalizeToken).join(' ');

  let bestKey: string | null = null;
  let bestLen = 0;

  for (const [key, words] of Object.entries(synonyms)) {
    for (const word of words) {
      const w = word.toLowerCase();
      // Multi-word synonyms: substring match on the joined transcript.
      if (w.includes(' ')) {
        if (joined.includes(w) && w.length > bestLen) {
          bestKey = key;
          bestLen = w.length;
        }
        continue;
      }
      // Single-word synonyms: exact token match (records index to strip from name).
      rawTokens.forEach((tok, idx) => {
        if (normalizeToken(tok) === w) {
          if (w.length >= bestLen) {
            bestKey = key;
            bestLen = w.length;
          }
          matchedTokens.add(idx);
        }
      });
    }
  }

  return { key: bestKey, matchedTokens };
}

/**
 * Extract the longest run of spoken digits (number-words + digit chars) as the mobile.
 * Records which token indices contributed so they can be removed from the name.
 * Returns up to 10 digits.
 */
function extractMobile(rawTokens: string[]): { mobile: string; usedTokens: Set<number> } {
  let best = '';
  let bestUsed: Set<number> = new Set();

  let current = '';
  let currentUsed: Set<number> = new Set();

  const flush = () => {
    if (current.length > best.length) {
      best = current;
      bestUsed = currentUsed;
    }
    current = '';
    currentUsed = new Set();
  };

  rawTokens.forEach((tok, idx) => {
    const digits = tokenToDigits(tok);
    if (digits) {
      current += digits;
      currentUsed.add(idx);
    } else {
      flush();
    }
  });
  flush();

  return { mobile: best.slice(0, 10), usedTokens: bestUsed };
}

/**
 * Build the name from the tokens not consumed by mobile/purpose, dropping stop words.
 */
function extractName(rawTokens: string[], used: Set<number>): string {
  const parts: string[] = [];
  rawTokens.forEach((tok, idx) => {
    if (used.has(idx)) return;
    const norm = normalizeToken(tok);
    if (!norm) return;
    if (STOP_WORDS.has(norm)) return;
    // Skip stray tokens that are purely digits/number-words not captured in the main run.
    if (tokenToDigits(tok)) return;
    parts.push(tok.replace(/[.,!?;:"']/g, '').trim());
  });

  const name = parts.join(' ').replace(/\s+/g, ' ').trim();
  // Title-case ASCII words; leave native scripts untouched.
  return name
    .split(' ')
    .map((w) => (/^[a-z]/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function tokenize(transcript: string): string[] {
  return transcript
    .replace(/[-_/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// ─── Public parsers ────────────────────────────────────────────────
export function parseVisitorSpeech(transcript: string, _lang?: DictationLang): ParsedVisitor {
  const tokens = tokenize(transcript);
  const { mobile, usedTokens } = extractMobile(tokens);
  const { key: purpose, matchedTokens } = matchCategory(tokens, PURPOSE_SYNONYMS);

  const used = new Set<number>([...usedTokens, ...matchedTokens]);
  const name = extractName(tokens, used);

  return { name, mobile, purpose };
}

export function parseDeliverySpeech(transcript: string, _lang?: DictationLang): ParsedDelivery {
  const tokens = tokenize(transcript);
  const { mobile, usedTokens } = extractMobile(tokens);
  const { key: deliveryType, matchedTokens } = matchCategory(tokens, DELIVERY_SYNONYMS);

  const used = new Set<number>([...usedTokens, ...matchedTokens]);
  const name = extractName(tokens, used);

  return { name, mobile, deliveryType };
}
