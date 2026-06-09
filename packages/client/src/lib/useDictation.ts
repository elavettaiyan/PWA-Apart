import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

export type DictationLang = 'en-IN' | 'ta-IN' | 'hi-IN';

export const DICTATION_LANGUAGES: { value: DictationLang; label: string }[] = [
  { value: 'en-IN', label: 'EN' },
  { value: 'ta-IN', label: 'தமிழ்' },
  { value: 'hi-IN', label: 'हिंदी' },
];

// ─── Digit conversion ──────────────────────────────────────────────
// Maps spoken single-digit words (English, Tamil, Hindi) to ASCII digits.
const WORD_TO_DIGIT: Record<string, string> = {
  // English
  zero: '0', oh: '0', o: '0', nought: '0',
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
  // Tamil
  பூஜ்ஜியம்: '0', சுழியம்: '0',
  ஒன்று: '1', இரண்டு: '2', மூன்று: '3', நான்கு: '4', ஐந்து: '5',
  ஆறு: '6', ஏழு: '7', எட்டு: '8', ஒன்பது: '9',
  // Hindi
  शून्य: '0', जीरो: '0', 'ज़ीरो': '0',
  एक: '1', दो: '2', तीन: '3', चार: '4', पांच: '5', 'पाँच': '5',
  छह: '6', 'छः': '6', सात: '7', आठ: '8', नौ: '9',
};

// Native digit scripts → ASCII (Devanagari ०-९, Tamil ௦-௯).
const NATIVE_DIGITS: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
  '௦': '0', '௧': '1', '௨': '2', '௩': '3', '௪': '4', '௫': '5', '௬': '6', '௭': '7', '௮': '8', '௯': '9',
};

/**
 * Convert a spoken transcript into a digit string (max 10 digits for India).
 * Handles ASCII digits, native digit scripts, and single-digit words in en/ta/hi.
 * Does NOT attempt to parse compound number-words (e.g. "ninety-eight"); guards are
 * instructed to speak digits one at a time.
 */
export function toDigits(transcript: string, _lang?: DictationLang): string {
  if (!transcript) return '';

  let out = '';
  // Split on whitespace and common separators to catch spoken words.
  const tokens = transcript
    .toLowerCase()
    .replace(/[-_.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    if (WORD_TO_DIGIT[token] !== undefined) {
      out += WORD_TO_DIGIT[token];
      continue;
    }
    // Walk each character: ASCII digit, native digit, or skip.
    for (const ch of token) {
      if (ch >= '0' && ch <= '9') {
        out += ch;
      } else if (NATIVE_DIGITS[ch] !== undefined) {
        out += NATIVE_DIGITS[ch];
      }
    }
  }

  return out.slice(0, 10);
}

// ─── Hook ──────────────────────────────────────────────────────────
const isNative = Capacitor.isNativePlatform();

// Toggle verbose logging for debugging speech recognition on device.
// View on Android: `adb logcat | grep Capacitor/Console` or Chrome remote inspect.
// View on iOS: Safari Web Inspector console.
const DEBUG = true;
function log(...args: unknown[]) {
  if (DEBUG) console.log('[dictation]', ...args);
}

function getBrowserRecognition(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export interface DictateOptions {
  /** Called for each interim/partial transcript while listening. */
  onPartial?: (text: string) => void;
  /** Called once when recognition stops, with the final transcript. */
  onFinal: (text: string) => void;
}

export function useDictation() {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);

  const latestRef = useRef('');
  const partialHandle = useRef<any>(null);
  const stateHandle = useRef<any>(null);
  const browserRecRef = useRef<any>(null);
  const onPartialRef = useRef<((t: string) => void) | null>(null);
  const onFinalRef = useRef<((t: string) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isNative) {
        try {
          const { available } = await SpeechRecognition.available();
          log('native available =', available);
          if (!cancelled) setSupported(!!available);
        } catch (e) {
          log('available() error', e);
          if (!cancelled) setSupported(false);
        }
      } else {
        const ok = !!getBrowserRecognition();
        log('browser available =', ok);
        setSupported(ok);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const removeNativeListeners = useCallback(async () => {
    try {
      await partialHandle.current?.remove?.();
    } catch {
      /* noop */
    }
    try {
      await stateHandle.current?.remove?.();
    } catch {
      /* noop */
    }
    partialHandle.current = null;
    stateHandle.current = null;
  }, []);

  const finalize = useCallback(
    (text: string) => {
      const cb = onFinalRef.current;
      onFinalRef.current = null;
      onPartialRef.current = null;
      setListening(false);
      log('finalize ->', JSON.stringify(text));
      cb?.(text);
    },
    [],
  );

  const ensurePermission = useCallback(async (): Promise<boolean> => {
    if (!isNative) return true;
    try {
      const current = await SpeechRecognition.checkPermissions();
      log('permission (check) =', current.speechRecognition);
      if (current.speechRecognition === 'granted') return true;
      const requested = await SpeechRecognition.requestPermissions();
      log('permission (request) =', requested.speechRecognition);
      return requested.speechRecognition === 'granted';
    } catch (e) {
      log('permission error', e);
      return false;
    }
  }, []);

  /**
   * Begin listening. Resolves once recognition has STARTED (not finished).
   * Interim text arrives via onPartial; the final transcript via onFinal when
   * recognition stops (auto on silence, or via stop()).
   */
  const start = useCallback(
    async (lang: DictationLang, opts: DictateOptions): Promise<void> => {
      if (!supported || listening) return;
      latestRef.current = '';
      onPartialRef.current = opts.onPartial ?? null;
      onFinalRef.current = opts.onFinal;

      if (isNative) {
        const granted = await ensurePermission();
        if (!granted) {
          onFinalRef.current = null;
          throw new Error('PERMISSION_DENIED');
        }

        await removeNativeListeners();

        partialHandle.current = await SpeechRecognition.addListener('partialResults', (data: any) => {
          const text = (data?.matches?.[0] ?? '').trim();
          log('partialResults', JSON.stringify(text));
          if (text) {
            latestRef.current = text;
            onPartialRef.current?.(text);
          }
        });

        stateHandle.current = await SpeechRecognition.addListener('listeningState', (data: any) => {
          log('listeningState', data?.status);
          if (data?.status === 'stopped') {
            void removeNativeListeners();
            finalize(latestRef.current);
          }
        });

        setListening(true);
        try {
          log('calling start()', lang);
          await SpeechRecognition.start({
            language: lang,
            maxResults: 2,
            partialResults: true,
            popup: false,
          });
          log('start() resolved');
        } catch (e) {
          log('start() error', e);
          await removeNativeListeners();
          setListening(false);
          onFinalRef.current = null;
          onPartialRef.current = null;
          throw e;
        }
        return;
      }

      // Browser / PWA fallback via Web Speech API.
      const Recognition = getBrowserRecognition();
      if (!Recognition) {
        onFinalRef.current = null;
        return;
      }
      const rec = new Recognition();
      browserRecRef.current = rec;
      rec.lang = lang;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (event: any) => {
        let text = '';
        for (let i = 0; i < event.results.length; i += 1) {
          text += event.results[i][0].transcript;
        }
        text = text.trim();
        if (text) {
          latestRef.current = text;
          onPartialRef.current?.(text);
        }
      };
      rec.onerror = (e: any) => {
        log('browser onerror', e?.error);
        browserRecRef.current = null;
        finalize(latestRef.current);
      };
      rec.onend = () => {
        browserRecRef.current = null;
        finalize(latestRef.current);
      };
      setListening(true);
      try {
        rec.start();
      } catch (e) {
        log('browser start error', e);
        browserRecRef.current = null;
        finalize('');
      }
    },
    [supported, listening, ensurePermission, removeNativeListeners, finalize],
  );

  /** Stop listening; the final transcript is delivered via onFinal. */
  const stop = useCallback(async () => {
    log('stop() requested');
    if (isNative) {
      try {
        await SpeechRecognition.stop();
      } catch (e) {
        log('stop() error', e);
      }
      // Fallback in case the listeningState event does not fire.
      await removeNativeListeners();
      finalize(latestRef.current);
    } else if (browserRecRef.current) {
      try {
        browserRecRef.current.stop();
      } catch {
        /* onend will finalize */
      }
    } else {
      finalize(latestRef.current);
    }
  }, [removeNativeListeners, finalize]);

  return { supported, listening, start, stop };
}

