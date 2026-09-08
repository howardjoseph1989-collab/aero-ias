import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VOICE_PROVIDER,
  GROK_VOICE_STATUS,
  isKnownVoiceProvider,
  normalizeVoiceProvider,
  readStoredVoiceProvider,
  resolveVoiceProvider,
  voiceProviderHint,
  writeStoredVoiceProvider,
} from './voiceProviders.js';
import { GEV_VOICE_TOOL_COUNT, gevVoiceToolNames, toGeminiFunctionDeclarations } from './gevToolSchemas.mjs';

test('OpenAI and Gemini are the only selectable voice providers', () => {
  assert.equal(isKnownVoiceProvider('openai'), true);
  assert.equal(isKnownVoiceProvider('gemini'), true);
  assert.equal(isKnownVoiceProvider('grok'), false);
  assert.equal(normalizeVoiceProvider('GEMINI'), 'gemini');
  assert.equal(normalizeVoiceProvider('nope'), DEFAULT_VOICE_PROVIDER);
});

test('Grok is documented as unavailable rather than offered as a fake path', () => {
  assert.equal(GROK_VOICE_STATUS.available, false);
  assert.match(GROK_VOICE_STATUS.reason, /no documented realtime voice API/i);
});

test('provider resolution prefers a stored provider that is actually configured', () => {
  assert.equal(resolveVoiceProvider({ stored: 'gemini', openai: true, gemini: true }), 'gemini');
  assert.equal(resolveVoiceProvider({ stored: 'gemini', openai: true, gemini: false }), 'openai');
  assert.equal(resolveVoiceProvider({ stored: 'openai', openai: false, gemini: true }), 'gemini');
  assert.equal(resolveVoiceProvider({ stored: 'openai', openai: false, gemini: false }), 'openai');
});

test('voice provider preference persists through a storage stub', () => {
  const storage = new Map();
  const stub = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, value); },
  };
  assert.equal(readStoredVoiceProvider(stub), 'openai');
  assert.equal(writeStoredVoiceProvider('gemini', stub), 'gemini');
  assert.equal(readStoredVoiceProvider(stub), 'gemini');
});

test('provider hint stays honest about missing keys', () => {
  assert.match(voiceProviderHint('gemini', { gemini: false }), /GEMINI_API_KEY/);
  assert.match(voiceProviderHint('openai', { openai: false }), /OPENAI_API_KEY/);
});

test('Gemini function declarations keep the same 28 action names as OpenAI Realtime', () => {
  const names = gevVoiceToolNames();
  assert.equal(names.length, 28);
  assert.equal(GEV_VOICE_TOOL_COUNT, 28);
  const gemini = toGeminiFunctionDeclarations();
  assert.deepEqual(gemini.map((tool) => tool.name), names);
  assert.ok(gemini.every((tool) => tool.parameters && !('additionalProperties' in tool.parameters)));
});
