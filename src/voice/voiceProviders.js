/**
 * Voice provider registry for AERO IAS.
 *
 * Gemini is the default recommended brain/voice path: a server-brokered turn
 * (mic audio → generateContent + the same 28 gevActions tools → spoken reply)
 * so talking can drive the globe. OpenAI Realtime remains the optional
 * original always-on WebRTC path. Grok/xAI is out of scope — do not add it.
 */

export const VOICE_PROVIDERS = Object.freeze({
  gemini: Object.freeze({
    id: 'gemini',
    label: 'GEMINI',
    mode: 'turn',
    recommended: true,
    description: 'Recommended — Gemini generateContent turn, same 28 tools, then TTS',
  }),
  openai: Object.freeze({
    id: 'openai',
    label: 'OPENAI',
    mode: 'realtime',
    recommended: false,
    description: 'Optional original path — OpenAI Realtime over WebRTC',
  }),
});

export const DEFAULT_VOICE_PROVIDER = 'gemini';
export const RECOMMENDED_VOICE_PROVIDER = 'gemini';
export const VOICE_PROVIDER_STORAGE_KEY = 'godsEyeView.voice.provider';

const KNOWN_IDS = new Set(Object.keys(VOICE_PROVIDERS));

export function isKnownVoiceProvider(id) {
  return KNOWN_IDS.has(String(id || '').trim());
}

export function normalizeVoiceProvider(id, fallback = DEFAULT_VOICE_PROVIDER) {
  const raw = String(id || '').trim().toLowerCase();
  return KNOWN_IDS.has(raw) ? raw : fallback;
}

/**
 * Pick the provider the MIC should use.
 *
 * A stored choice wins only when that provider has a key. Otherwise Gemini
 * is the recommended default whenever it is configured. OpenAI is the
 * fallback when only that key exists. A keyless session stays on Gemini so
 * start() names the recommended missing key.
 */
export function resolveVoiceProvider({
  stored = DEFAULT_VOICE_PROVIDER,
  openai = false,
  gemini = false,
} = {}) {
  const preferred = normalizeVoiceProvider(stored);
  if (preferred === 'gemini' && gemini) return 'gemini';
  if (preferred === 'openai' && openai) return 'openai';
  if (gemini) return 'gemini';
  if (openai) return 'openai';
  return preferred;
}

function voiceStorage(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readStoredVoiceProvider(storage) {
  try {
    const raw = voiceStorage(storage)?.getItem(VOICE_PROVIDER_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_VOICE_PROVIDER;
    return normalizeVoiceProvider(raw);
  } catch {
    return DEFAULT_VOICE_PROVIDER;
  }
}

export function writeStoredVoiceProvider(id, storage) {
  const resolved = normalizeVoiceProvider(id);
  try {
    voiceStorage(storage)?.setItem(VOICE_PROVIDER_STORAGE_KEY, resolved);
  } catch {
    /* best effort */
  }
  return resolved;
}

export function voiceProviderHint(provider, { openai = false, gemini = false } = {}) {
  const id = normalizeVoiceProvider(provider);
  if (id === 'gemini') {
    return gemini
      ? 'Recommended — hold Space or tap MIC, then pause to send a Gemini turn'
      : 'Recommended path — add GEMINI_API_KEY or GOOGLE_API_KEY in Provider Settings';
  }
  return openai
    ? 'Optional OpenAI Realtime — hold Space to speak · click mic to toggle'
    : 'Optional original path — needs OPENAI_API_KEY in Provider Settings';
}
