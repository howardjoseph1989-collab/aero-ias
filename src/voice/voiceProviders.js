/**
 * Voice provider registry for AERO IAS.
 *
 * OpenAI Realtime stays the original always-on WebRTC path. Gemini is the
 * practical free-tier alternative: a server-brokered turn (mic audio →
 * generateContent + the same 28 gevActions tools → spoken reply). xAI Grok
 * has no documented browser-safe realtime voice API with tool calling, so it
 * is listed only as unavailable — never offered as a working toggle.
 */

export const VOICE_PROVIDERS = Object.freeze({
  openai: Object.freeze({
    id: 'openai',
    label: 'OPENAI',
    mode: 'realtime',
    description: 'OpenAI Realtime over WebRTC — original always-on mic path',
  }),
  gemini: Object.freeze({
    id: 'gemini',
    label: 'GEMINI',
    mode: 'turn',
    description: 'Gemini generateContent turn — mic audio, same tools, then TTS',
  }),
});

export const GROK_VOICE_STATUS = Object.freeze({
  id: 'grok',
  label: 'GROK',
  available: false,
  reason: 'xAI Grok has no documented realtime voice API with tool calling that AERO IAS can broker the way OpenAI Realtime or Gemini generateContent can. Not offered as a fake provider.',
});

export const DEFAULT_VOICE_PROVIDER = 'openai';
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
 * Stored preference wins when that provider is configured; otherwise OpenAI,
 * then Gemini, then the stored/default id so a keyless session still has a
 * toggle target (start() then surfaces the missing-key error).
 */
export function resolveVoiceProvider({
  stored = DEFAULT_VOICE_PROVIDER,
  openai = false,
  gemini = false,
} = {}) {
  const preferred = normalizeVoiceProvider(stored);
  if (preferred === 'openai' && openai) return 'openai';
  if (preferred === 'gemini' && gemini) return 'gemini';
  if (openai) return 'openai';
  if (gemini) return 'gemini';
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
    return normalizeVoiceProvider(voiceStorage(storage)?.getItem(VOICE_PROVIDER_STORAGE_KEY));
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
      ? 'Hold Space or tap MIC — speak, then release to send a Gemini turn'
      : 'Needs GEMINI_API_KEY or GOOGLE_API_KEY — add it in Provider Settings';
  }
  return openai
    ? 'Hold Space to speak · click mic to toggle OpenAI Realtime'
    : 'Needs OPENAI_API_KEY — add it in Provider Settings';
}
