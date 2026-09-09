import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioInputDeviceIds,
  bytesToBase64,
  countAudioInputDevices,
  downsampleToRate,
  encodeWavPcm16,
  floatTo16BitPcm,
  GevGeminiController,
  isFatalMicrophoneError,
  mapMicrophoneError,
  microphoneConstraintLadder,
  microphoneDeviceCheck,
  microphonePreflight,
  requestMicrophoneStream,
  resolveAeroMicPrompt,
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

test('microphone preflight names HTTPS and missing getUserMedia before capture', () => {
  assert.deepEqual(microphonePreflight({ isSecureContext: false }), {
    ok: false,
    reason: 'insecure',
    message: 'Microphone needs HTTPS — open AERO IAS over https:// or localhost',
  });
  assert.equal(microphonePreflight({ hasGetUserMedia: false }).reason, 'unsupported');
  assert.equal(microphonePreflight().ok, true);
});

test('enumerateDevices with visible devices but zero audioinputs fails closed', () => {
  assert.deepEqual(microphoneDeviceCheck([]), { ok: true, audioInputCount: 0, unknown: true });
  assert.equal(microphoneDeviceCheck([{ kind: 'videoinput', deviceId: 'cam' }]).ok, false);
  assert.equal(
    microphoneDeviceCheck([{ kind: 'videoinput', deviceId: 'cam' }]).message,
    'No microphone found — plug in a mic or allow access',
  );
  assert.equal(microphoneDeviceCheck([{ kind: 'audioinput', deviceId: 'mic-1' }]).audioInputCount, 1);
  assert.equal(countAudioInputDevices([{ kind: 'audioinput' }, { kind: 'videoinput' }]), 1);
  assert.deepEqual(audioInputDeviceIds([{ kind: 'audioinput', deviceId: 'mic-1' }]), ['mic-1']);
});

test('getUserMedia constraint ladder is ideal, then audio:true, then any device', () => {
  const bare = microphoneConstraintLadder();
  assert.deepEqual(bare[0], {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });
  assert.deepEqual(bare[1], { audio: true });
  assert.deepEqual(bare.at(-1), { audio: {} });
  const withDevice = microphoneConstraintLadder(['mic-9']);
  assert.deepEqual(withDevice[2], { audio: { deviceId: { exact: 'mic-9' } } });
  assert.deepEqual(withDevice[3], { audio: { deviceId: 'mic-9' } });
});

test('microphone errors map to actionable AERO MIC status text', () => {
  assert.equal(
    mapMicrophoneError({ name: 'NotFoundError' }),
    'No microphone found — plug in a mic or allow access',
  );
  assert.equal(
    mapMicrophoneError({ name: 'NotAllowedError' }),
    'Microphone blocked — allow access in the browser, then tap AERO MIC',
  );
  assert.equal(
    mapMicrophoneError({ name: 'NotReadableError' }),
    'Microphone busy — close other apps using the mic, then try again',
  );
  assert.equal(
    mapMicrophoneError({ name: 'SecurityError' }, { isSecureContext: false }),
    'Microphone needs HTTPS — open AERO IAS over https:// or localhost',
  );
  assert.equal(isFatalMicrophoneError({ name: 'NotAllowedError' }), true);
  assert.equal(isFatalMicrophoneError({ name: 'OverconstrainedError' }), false);
});

test('progressive getUserMedia skips OverconstrainedError and stops on NotAllowedError', async () => {
  const attempts = [];
  const media = {
    getUserMedia: async (constraints) => {
      attempts.push(constraints);
      if (constraints.audio && constraints.audio !== true && constraints.audio.echoCancellation) {
        const error = new Error('overconstrained');
        error.name = 'OverconstrainedError';
        throw error;
      }
      return { id: 'stream-ok', getTracks: () => [] };
    },
  };
  const stream = await requestMicrophoneStream(media);
  assert.equal(stream.id, 'stream-ok');
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1], { audio: true });

  const denied = {
    getUserMedia: async () => {
      const error = new Error('blocked');
      error.name = 'NotAllowedError';
      throw error;
    },
  };
  await assert.rejects(() => requestMicrophoneStream(denied), { name: 'NotAllowedError' });
});

test('AERO MIC prompt is Speak now, Listening, or Error', () => {
  assert.deepEqual(resolveAeroMicPrompt({ status: 'listening' }), {
    label: 'Speak now',
    heading: 'SPEAK NOW',
    detail: 'Speak now — pause to send',
    prompt: 'speak',
  });
  assert.equal(resolveAeroMicPrompt({ status: 'listening', heardSpeech: true }).label, 'Listening');
  assert.equal(resolveAeroMicPrompt({ status: 'error', detail: 'No microphone found — plug in a mic or allow access' }).label, 'Error');
  assert.equal(resolveAeroMicPrompt({ status: 'idle' }).label, 'AERO MIC');
});

test('Gemini start enumerates devices, refuses insecure context, and surfaces mic errors', async () => {
  const ui = {
    root: { dataset: {} },
    status: { textContent: '' },
    detail: { textContent: '', title: '' },
    errorDetail: { textContent: '' },
    buttonLabel: { textContent: '' },
    helpDetail: { textContent: '' },
  };

  const insecure = new GevGeminiController({
    runner: async () => ({}),
    ui,
    isSecureContext: false,
    mediaDevices: { getUserMedia: async () => ({}) },
  });
  await insecure.start();
  assert.equal(insecure.status, 'error');
  assert.match(ui.detail.textContent, /HTTPS/);
  assert.equal(ui.buttonLabel.textContent, 'Error');
  assert.equal(ui.root.dataset.micPrompt, 'error');

  const noMic = new GevGeminiController({
    runner: async () => ({}),
    ui,
    isSecureContext: true,
    mediaDevices: {
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'cam' }],
      getUserMedia: async () => {
        throw new Error('should not call getUserMedia');
      },
    },
  });
  await noMic.start();
  assert.equal(noMic.status, 'error');
  assert.match(ui.detail.textContent, /No microphone found/);
});
