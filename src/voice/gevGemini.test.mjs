import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesToBase64,
  downsampleToRate,
  encodeWavPcm16,
  floatTo16BitPcm,
  GevGeminiController,
  rmsLevel,
  shouldCloseGeminiTurn,
} from './gevGemini.js';
import { gevVoiceToolNames } from './gevToolSchemas.mjs';

test('WAV encoding writes a mono 16-bit header around PCM samples', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1]);
  const wav = encodeWavPcm16(samples, 16000);
  const view = new DataView(wav);
  assert.equal(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'RIFF');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(floatTo16BitPcm(samples).length, 4);
  assert.ok(bytesToBase64(wav).length > 20);
});

test('downsample and RMS helpers stay numeric-safe', () => {
  const source = new Float32Array([1, 1, 0, 0]);
  const down = downsampleToRate(source, 32000, 16000);
  assert.equal(down.length, 2);
  assert.equal(rmsLevel(new Float32Array([0, 0, 0])), 0);
  assert.ok(rmsLevel(new Float32Array([1, -1])) > 0);
});

test('Gemini turn close policy: silence after speech, max length, and PTT hold', () => {
  assert.deepEqual(shouldCloseGeminiTurn({ elapsedMs: 21_000 }), { close: true, reason: 'max' });
  assert.deepEqual(shouldCloseGeminiTurn({
    elapsedMs: 2000,
    heardSpeech: true,
    silentMs: 1300,
  }), { close: true, reason: 'silence' });
  assert.equal(shouldCloseGeminiTurn({
    elapsedMs: 2000,
    heardSpeech: true,
    silentMs: 1300,
    pushToTalk: true,
  }).close, false);
  assert.equal(shouldCloseGeminiTurn({
    elapsedMs: 800,
    heardSpeech: false,
    silentMs: 2000,
  }).close, false);
});

test('Gemini controller executes gevActions and posts tool results back', async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.toolResults) {
      return {
        ok: true,
        json: async () => ({ text: 'Flying to Tokyo', functionCalls: [], history: [] }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        functionCalls: [{ name: 'fly_to_location', args: { query: 'Tokyo' } }],
        text: null,
        history: [],
      }),
    };
  };
  const runnerCalls = [];
  const runner = async (name, args) => {
    runnerCalls.push({ name, args });
    return { ok: true, action: name, query: args.query };
  };
  const ui = {
    root: { dataset: {} },
    status: { textContent: '' },
    detail: { textContent: '', title: '' },
    errorDetail: { textContent: '' },
    buttonLabel: { textContent: '' },
    helpDetail: { textContent: '' },
  };
  const controller = new GevGeminiController({ runner, ui, fetchImpl });
  controller.setStatus('listening', 'test');
  await controller.submitTurn({ audio: 'YWJjZA==', mimeType: 'audio/wav' });
  assert.deepEqual(runnerCalls, [{ name: 'fly_to_location', args: { query: 'Tokyo' } }]);
  assert.equal(calls[1].toolResults[0].name, 'fly_to_location');
  assert.equal(calls[1].toolResults[0].response.ok, true);
  assert.ok(gevVoiceToolNames().includes('fly_to_location'));
});
