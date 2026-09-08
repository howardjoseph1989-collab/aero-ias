import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aeroIasVoiceInstructions,
  buildGeminiGenerateRequest,
  buildGeminiTtsRequest,
  extractGeminiTurn,
  geminiVoiceStatus,
  parseGeminiTurnBody,
  resolveGeminiApiKey,
  runGeminiTurn,
  sanitizeGeminiError,
} from './geminiBroker.mjs';
import { GEV_VOICE_TOOL_COUNT } from './gevToolSchemas.mjs';

test('Gemini key resolution prefers GEMINI_API_KEY over GOOGLE_API_KEY', () => {
  assert.equal(resolveGeminiApiKey({ GEMINI_API_KEY: ' g-1 ', GOOGLE_API_KEY: 'g-2' }), 'g-1');
  assert.equal(resolveGeminiApiKey({ GOOGLE_API_KEY: 'g-2' }), 'g-2');
  assert.equal(resolveGeminiApiKey({}), '');
});

test('Gemini status reports the turn-based mode without leaking the key', () => {
  const status = geminiVoiceStatus({ GEMINI_API_KEY: 'secret-key', GEMINI_VOICE_MODEL: 'gemini-2.5-flash' });
  assert.equal(status.available, true);
  assert.equal(status.mode, 'turn');
  assert.equal(status.toolCount, GEV_VOICE_TOOL_COUNT);
  assert.equal(JSON.stringify(status).includes('secret-key'), false);
});

test('turn body requires audio or tool results and rejects oversized or hostile audio', () => {
  assert.equal(parseGeminiTurnBody(null).ok, false);
  assert.equal(parseGeminiTurnBody({}).ok, false);
  assert.equal(parseGeminiTurnBody({ audio: '%%%' }).ok, false);
  assert.equal(parseGeminiTurnBody({ audio: 'abcd', mimeType: 'image/png' }).ok, false);
  const audio = parseGeminiTurnBody({ audio: 'YWJjZA==', mimeType: 'audio/wav' });
  assert.equal(audio.ok, true);
  assert.equal(audio.turn.kind, 'audio');
  const tools = parseGeminiTurnBody({
    toolResults: [{ name: 'zoom_to_globe', response: { ok: true } }],
  });
  assert.equal(tools.ok, true);
  assert.equal(tools.turn.kind, 'tools');
});

test('generateContent request carries AERO IAS instructions and all 28 tools', () => {
  const parsed = parseGeminiTurnBody({ audio: 'YWJjZA==', mimeType: 'audio/wav', sceneContext: 'Austin' });
  const request = buildGeminiGenerateRequest(parsed.turn);
  assert.match(request.systemInstruction.parts[0].text, /AERO IAS/);
  assert.match(aeroIasVoiceInstructions(), /Only control the app by calling the provided tools/);
  assert.equal(request.tools[0].functionDeclarations.length, 28);
  assert.equal(request.contents.at(-1).parts[0].inlineData.mimeType, 'audio/wav');
});

test('TTS request is skipped for empty text and otherwise asks for AUDIO', () => {
  assert.equal(buildGeminiTtsRequest(''), null);
  const request = buildGeminiTtsRequest('Flying to Tokyo');
  assert.deepEqual(request.generationConfig.responseModalities, ['AUDIO']);
});

test('extractGeminiTurn splits function calls from spoken text', () => {
  const extracted = extractGeminiTurn({
    candidates: [{
      content: {
        role: 'model',
        parts: [
          { functionCall: { name: 'fly_to_location', args: { query: 'Tokyo' } } },
          { text: '  ' },
        ],
      },
    }],
  });
  assert.deepEqual(extracted.functionCalls, [{ name: 'fly_to_location', args: { query: 'Tokyo' } }]);
  assert.equal(extracted.text, null);
});

test('Gemini errors never echo an API key query string', () => {
  const sanitized = sanitizeGeminiError(400, {
    error: { message: 'invalid key=super-secret&foo=1' },
  });
  assert.match(sanitized.error, /key=redacted/);
  assert.equal(sanitized.error.includes('super-secret'), false);
});

test('runGeminiTurn stays keyless-honest and executes a mocked generateContent loop', async () => {
  const missing = await runGeminiTurn({ env: {}, body: { audio: 'YWJjZA==' } });
  assert.equal(missing.status, 503);
  assert.match(missing.payload.error, /GEMINI_API_KEY/);

  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).includes('preview-tts')) {
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'UEs=' } }] } }],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { role: 'model', parts: [{ text: 'Flying to Tokyo' }] } }],
      }),
    };
  };

  const result = await runGeminiTurn({
    env: { GEMINI_API_KEY: 'test-key' },
    body: { audio: 'YWJjZA==', mimeType: 'audio/wav' },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.text, 'Flying to Tokyo');
  assert.equal(result.payload.functionCalls.length, 0);
  assert.equal(result.payload.audio, 'UEs=');
  assert.equal(calls[0].url.includes('key=test-key'), true);
  assert.equal(calls[0].body.tools[0].functionDeclarations.length, 28);
});
