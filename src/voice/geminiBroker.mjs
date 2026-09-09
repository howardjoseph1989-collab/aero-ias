/**
 * Server-side Gemini voice broker — pure request/response helpers.
 *
 * Gemini Live / native-audio realtime is a different transport (WebSocket)
 * and does not mint a browser-safe WebRTC ephemeral token the way OpenAI
 * Realtime does. AERO IAS therefore uses generateContent:
 *   mic audio (or tool results) → Gemini → function calls and/or text → TTS
 *
 * The API key never leaves the server. Callers pass env + fetch.
 */

import { GEV_REALTIME_TOOLS, toGeminiFunctionDeclarations } from './gevToolSchemas.mjs';

export const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
// Gemini 3.6 Flash is the recommended voice+tools model (audio in, text/tools out).
// Override with GEMINI_VOICE_MODEL. It does not support audio generation — spoken
// replies stay on a dedicated TTS id (DEFAULT_GEMINI_TTS_MODEL / GEMINI_TTS_MODEL).
export const DEFAULT_GEMINI_VOICE_MODEL = 'gemini-3.6-flash';
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
export const GEMINI_TURN_BODY_LIMIT = 2 * 1024 * 1024;
export const GEMINI_AUDIO_B64_LIMIT = 1_400_000;
export const GEMINI_HISTORY_LIMIT = 24;
export const GEMINI_ALLOWED_AUDIO_TYPES = Object.freeze([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
]);

const PRINTABLE_KEY = /^[\x21-\x7e]+$/;

export function resolveGeminiApiKey(env = {}) {
  const preferred = String(env.GEMINI_API_KEY ?? '').trim();
  if (preferred) return preferred;
  return String(env.GOOGLE_API_KEY ?? '').trim();
}

export function resolveGeminiModels(env = {}) {
  return {
    voice: String(env.GEMINI_VOICE_MODEL ?? '').trim() || DEFAULT_GEMINI_VOICE_MODEL,
    tts: String(env.GEMINI_TTS_MODEL ?? '').trim() || DEFAULT_GEMINI_TTS_MODEL,
  };
}

export function geminiVoiceStatus(env = {}) {
  const key = resolveGeminiApiKey(env);
  const models = resolveGeminiModels(env);
  return {
    available: Boolean(key),
    provider: 'gemini',
    mode: 'turn',
    model: models.voice,
    ttsModel: models.tts,
    toolCount: GEV_REALTIME_TOOLS.length,
  };
}

export function buildGeminiGenerateUrl(model, apiKey) {
  const id = encodeURIComponent(String(model || DEFAULT_GEMINI_VOICE_MODEL));
  return `${GEMINI_GENERATE_URL}/${id}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export function aeroIasVoiceInstructions() {
  return [
    'You are AERO IAS Voice Control, a concise voice controller for a Cesium geospatial app called AERO IAS (fork of God\'s Eye View).',
    'The user is speaking into a microphone. Treat the attached audio as their latest command. If a transcript is also provided, prefer the audio and use the transcript only as a hint.',
    'Have a natural spoken conversation. Do not require a wake phrase.',
    'Only control the app by calling the provided tools. Never invent tool names or arguments.',
    'Call tools only for clear AERO IAS control, navigation, visual-style, layer, or app-state requests. For ordinary conversation, answer normally without tools.',
    'For requests to open, show, reveal, or focus a menu/panel, call set_panel_open or show_data_layers_menu. "Open Context" means only set_panel_open{panelId:"global-context-panel",open:true}. "Open Contacts" means set_context_mode{mode:"contacts"}.',
    'For "what am I looking at?", "what is this?", or current view contents, call get_entity_context first, then answer from the returned scene/entity context.',
    'For ANALYTICAL questions about layer data — how many / which / fastest / highest / biggest / nearest — call analyst_query, not get_entity_context.',
    'When a request requires a tool call, do not speak in the same response as the tool call. Call the tool first.',
    'When a single user request contains MULTIPLE changes, call ALL the corresponding tools before speaking.',
    'After receiving tool output, speak exactly one short confirmation. Do not repeat the confirmation.',
    'Confirmations echo the RESULTING state, never the request. On ok=false, state the failure plainly. Never claim an action without ok=true in the tool result.',
    'For destination requests, call fly_to_location. For relative zoom, call adjust_camera_zoom. "Globe view" / "whole earth" uses zoom_to_globe.',
    'Keep spoken confirmations short, e.g. "Opening datacenters" or "Flying to London".',
    'AERO IAS is an exploratory visualization of public data. Do not invent places, counts, or labels that tools did not return.',
  ].join('\n');
}

function isAllowedAudioType(mimeType) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return GEMINI_ALLOWED_AUDIO_TYPES.includes(base);
}

function clipHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-GEMINI_HISTORY_LIMIT);
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * Validate and normalize a client turn body.
 * @returns {{ok: true, turn: object} | {ok: false, error: string, status?: number}}
 */
export function parseGeminiTurnBody(raw) {
  const body = asPlainObject(raw);
  if (!body) return { ok: false, error: 'Body must be a JSON object', status: 400 };

  const sceneContext = typeof body.sceneContext === 'string'
    ? body.sceneContext.slice(0, 8000)
    : '';
  const transcript = typeof body.transcript === 'string'
    ? body.transcript.slice(0, 2000)
    : '';
  const history = clipHistory(body.history);
  const speak = body.speak !== false;
  const toolResults = Array.isArray(body.toolResults)
    ? body.toolResults.slice(0, 16).map((item) => {
      const row = asPlainObject(item) || {};
      const name = String(row.name || '').trim();
      return {
        name,
        response: asPlainObject(row.response) || { ok: false, error: 'empty tool result' },
      };
    }).filter((row) => row.name)
    : [];

  const audio = typeof body.audio === 'string' ? body.audio.replace(/\s+/g, '') : '';
  const mimeType = String(body.mimeType || 'audio/wav').split(';')[0].trim().toLowerCase();

  if (toolResults.length) {
    return {
      ok: true,
      turn: { kind: 'tools', toolResults, history, sceneContext, transcript, speak },
    };
  }

  if (!audio) return { ok: false, error: 'audio or toolResults is required', status: 400 };
  if (audio.length > GEMINI_AUDIO_B64_LIMIT) {
    return { ok: false, error: 'audio payload is too large', status: 413 };
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(audio)) {
    return { ok: false, error: 'audio must be base64', status: 400 };
  }
  if (!isAllowedAudioType(mimeType)) {
    return { ok: false, error: `unsupported audio type: ${mimeType}`, status: 415 };
  }

  return {
    ok: true,
    turn: { kind: 'audio', audio, mimeType, history, sceneContext, transcript, speak },
  };
}

function userAudioParts(turn) {
  const parts = [];
  if (turn.kind === 'audio') {
    parts.push({
      inlineData: {
        mimeType: turn.mimeType,
        data: turn.audio,
      },
    });
  }
  const notes = [];
  if (turn.transcript) notes.push(`Operator transcript hint: ${turn.transcript}`);
  if (turn.sceneContext) notes.push(`Current AERO IAS scene context:\n${turn.sceneContext}`);
  if (notes.length) parts.push({ text: notes.join('\n\n') });
  if (!parts.length) parts.push({ text: 'Continue.' });
  return parts;
}

function toolResponseParts(turn) {
  return turn.toolResults.map((row) => ({
    functionResponse: {
      name: row.name,
      response: row.response,
    },
  }));
}

export function buildGeminiGenerateRequest(turn, {
  tools = GEV_REALTIME_TOOLS,
  instructions = aeroIasVoiceInstructions(),
} = {}) {
  const contents = [...clipHistory(turn.history)];
  if (turn.kind === 'tools') {
    contents.push({ role: 'user', parts: toolResponseParts(turn) });
  } else {
    contents.push({ role: 'user', parts: userAudioParts(turn) });
  }
  return {
    systemInstruction: { parts: [{ text: instructions }] },
    contents,
    tools: [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
  };
}

export function buildGeminiTtsRequest(text, { voiceName = 'Kore' } = {}) {
  const spoken = String(text || '').trim().slice(0, 500);
  if (!spoken) return null;
  return {
    contents: [{ role: 'user', parts: [{ text: spoken }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };
}

function partText(part) {
  if (typeof part?.text === 'string') return part.text;
  return '';
}

/**
 * Normalize a Gemini generateContent response into tool calls and spoken text.
 * Never includes the API key or raw request audio.
 */
export function extractGeminiTurn(data) {
  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const functionCalls = [];
  const texts = [];
  for (const part of parts) {
    const call = part?.functionCall;
    if (call?.name) {
      functionCalls.push({
        name: String(call.name),
        args: asPlainObject(call.args) || {},
      });
    }
    const text = partText(part).trim();
    if (text) texts.push(text);
  }
  const modelContent = candidate?.content
    ? { role: 'model', parts }
    : null;
  return {
    functionCalls,
    text: texts.join(' ').trim() || null,
    finishReason: candidate?.finishReason || null,
    modelContent,
    blocked: String(candidate?.finishReason || '').includes('SAFETY'),
  };
}

export function extractGeminiInlineAudio(data) {
  const parts = Array.isArray(data?.candidates?.[0]?.content?.parts)
    ? data.candidates[0].content.parts
    : [];
  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    if (inline?.data) {
      return {
        audio: inline.data,
        mimeType: inline.mimeType || inline.mime_type || 'audio/pcm',
      };
    }
  }
  return null;
}

export function sanitizeGeminiError(status, data, fallback = 'Gemini request failed') {
  const message = typeof data?.error?.message === 'string'
    ? data.error.message
    : typeof data?.error === 'string'
      ? data.error
      : fallback;
  const cleaned = String(message).replace(/key=[^&\s]+/gi, 'key=redacted').slice(0, 240);
  return { error: cleaned, status: status || 502 };
}

export function isPrintableSecret(value) {
  const text = String(value || '').trim();
  return text.length > 0 && PRINTABLE_KEY.test(text);
}

/**
 * Run one brokered Gemini turn. `fetchImpl` is injectable for tests.
 * @returns {Promise<{ok: boolean, status: number, payload: object}>}
 */
export async function runGeminiTurn({
  env = {},
  body,
  fetchImpl,
  speak = true,
} = {}) {
  const apiKey = resolveGeminiApiKey(env);
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      payload: { error: 'GEMINI_API_KEY (or GOOGLE_API_KEY) is not set' },
    };
  }
  const parsed = parseGeminiTurnBody(body);
  if (!parsed.ok) {
    return { ok: false, status: parsed.status || 400, payload: { error: parsed.error } };
  }

  const models = resolveGeminiModels(env);
  const request = buildGeminiGenerateRequest(parsed.turn);
  const doFetch = fetchImpl || globalThis.fetch;
  let upstream;
  let data;
  try {
    upstream = await doFetch(buildGeminiGenerateUrl(models.voice, apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    data = await upstream.json().catch(() => ({}));
  } catch (error) {
    return {
      ok: false,
      status: 502,
      payload: { error: error?.message || 'Gemini generateContent failed' },
    };
  }

  if (!upstream.ok) {
    const sanitized = sanitizeGeminiError(upstream.status, data);
    return { ok: false, status: sanitized.status, payload: { error: sanitized.error } };
  }

  const extracted = extractGeminiTurn(data);
  const history = [
    ...clipHistory(parsed.turn.history),
    parsed.turn.kind === 'tools'
      ? { role: 'user', parts: toolResponseParts(parsed.turn) }
      : { role: 'user', parts: userAudioParts({
        ...parsed.turn,
        audio: '[omitted]',
      }).map((part) => (
        part.inlineData ? { text: '[operator audio]' } : part
      )) },
    extracted.modelContent || { role: 'model', parts: extracted.text ? [{ text: extracted.text }] : [] },
  ].filter((item) => Array.isArray(item.parts) && item.parts.length);

  const payload = {
    provider: 'gemini',
    mode: 'turn',
    model: models.voice,
    functionCalls: extracted.functionCalls,
    text: extracted.text,
    finishReason: extracted.finishReason,
    blocked: extracted.blocked,
    history,
    audio: null,
    audioMimeType: null,
  };

  const shouldSpeak = (speak || parsed.turn.speak) && extracted.text && !extracted.functionCalls.length;
  if (shouldSpeak) {
    const ttsRequest = buildGeminiTtsRequest(extracted.text);
    if (ttsRequest) {
      try {
        const tts = await doFetch(buildGeminiGenerateUrl(models.tts, apiKey), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ttsRequest),
        });
        const ttsData = await tts.json().catch(() => ({}));
        if (tts.ok) {
          const clip = extractGeminiInlineAudio(ttsData);
          if (clip) {
            payload.audio = clip.audio;
            payload.audioMimeType = clip.mimeType;
          }
        }
      } catch {
        // Browser SpeechSynthesis is the documented fallback.
      }
    }
  }

  return { ok: true, status: 200, payload };
}
