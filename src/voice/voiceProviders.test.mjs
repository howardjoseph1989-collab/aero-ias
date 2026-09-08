import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VOICE_PROVIDER,
  RECOMMENDED_VOICE_PROVIDER,
  isKnownVoiceProvider,
  normalizeVoiceProvider,
  readStoredVoiceProvider,
  resolveVoiceProvider,
  voiceProviderHint,
  writeStoredVoiceProvider,
} from './voiceProviders.js';
import { GEV_VOICE_TOOL_COUNT, gevVoiceToolNames, toGeminiFunctionDeclarations } from './gevToolSchemas.mjs';

test('Gemini is the default recommended voice provider; Grok is not a provider', () => {
  assert.equal(DEFAULT_VOICE_PROVIDER, 'gemini');
  assert.equal(RECOMMENDED_VOICE_PROVIDER, 'gemini');
  assert.equal(isKnownVoiceProvider('gemini'), true);
  assert.equal(isKnownVoiceProvider('openai'), true);
  assert.equal(isKnownVoiceProvider('grok'), false);
  assert.equal(normalizeVoiceProvider('OPENAI'), 'openai');
  assert.equal(normalizeVoiceProvider('nope'), 'gemini');
});

test('provider resolution recommends Gemini and only honors a stored OpenAI choice when that key exists', () => {
  assert.equal(resolveVoiceProvider({ stored: 'gemini', openai: true, gemini: true }), 'gemini');
  assert.equal(resolveVoiceProvider({ stored: 'openai', openai: true, gemini: true }), 'openai');
  assert.equal(resolveVoiceProvider({ stored: 'openai', openai: false, gemini: true }), 'gemini');
  assert.equal(resolveVoiceProvider({ stored: 'gemini', openai: true, gemini: false }), 'openai');
  assert.equal(resolveVoiceProvider({ openai: true, gemini: true }), 'gemini');
  assert.equal(resolveVoiceProvider({ openai: false, gemini: false }), 'gemini');
});

test('voice provider preference persists through a storage stub and defaults to Gemini', () => {
  const storage = new Map();
  const stub = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, value); },
  };
  assert.equal(readStoredVoiceProvider(stub), 'gemini');
  assert.equal(writeStoredVoiceProvider('openai', stub), 'openai');
  assert.equal(readStoredVoiceProvider(stub), 'openai');
});

test('provider hint recommends Gemini and treats OpenAI as optional', () => {
  assert.match(voiceProviderHint('gemini', { gemini: false }), /GEMINI_API_KEY/);
  assert.match(voiceProviderHint('gemini', { gemini: true }), /Recommended/);
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
