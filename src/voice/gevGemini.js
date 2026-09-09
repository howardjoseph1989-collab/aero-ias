/**
 * Gemini turn-based voice session for AERO IAS.
 *
 * Records microphone audio, posts it to `/api/gemini/turn` (server holds the
 * Gemini key), executes the same gevActions runner as OpenAI Realtime, then
 * plays a TTS reply (Gemini audio when the broker returns one, otherwise the
 * browser SpeechSynthesis API).
 */

import { createGevActionRunner } from './gevActions.js';

function shouldPauseRadioForVoice({ status = 'idle', pushToTalkKeyHeld = false } = {}) {
  return status === 'connecting' || status === 'executing' || Boolean(pushToTalkKeyHeld);
}

function shouldStopVoiceAfterRadioTool(result) {
  return Boolean(
    result?.ok
    && result.action === 'control_radio'
    && ['play', 'resume', 'select', 'next', 'previous'].includes(result.radioAction),
  );
}

const STATUS = {
  idle: 'OFF',
  connecting: 'CONNECTING',
  listening: 'LISTENING',
  executing: 'EXECUTING',
  error: 'ERROR',
};

const TURN_URL = '/api/gemini/turn';
const MAX_TURN_MS = 20_000;
const SILENCE_MS = 1200;
const SPEECH_RMS = 0.045;
const TARGET_RATE = 16000;

export function floatTo16BitPcm(float32) {
  const input = float32 instanceof Float32Array ? float32 : new Float32Array(0);
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

export function downsampleToRate(float32, inputRate, outputRate = TARGET_RATE) {
  const source = float32 instanceof Float32Array ? float32 : new Float32Array(0);
  const inRate = Number(inputRate);
  const outRate = Number(outputRate);
  if (!source.length || !Number.isFinite(inRate) || inRate <= 0) return source;
  if (!Number.isFinite(outRate) || outRate <= 0 || Math.abs(inRate - outRate) < 1) {
    return source;
  }
  const ratio = inRate / outRate;
  const length = Math.max(1, Math.round(source.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(source.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += source[j];
      count += 1;
    }
    out[i] = count ? sum / count : source[Math.min(start, source.length - 1)];
  }
  return out;
}

export function encodeWavPcm16(float32, sampleRate = TARGET_RATE) {
  const pcm = floatTo16BitPcm(float32);
  const bytes = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, bytes, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer));
  return buffer;
}

export function bytesToBase64(bytes) {
  const source = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (typeof Buffer !== 'undefined') return Buffer.from(source).toString('base64');
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < source.length; i += chunk) {
    binary += String.fromCharCode(...source.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function rmsLevel(float32) {
  const input = float32 instanceof Float32Array ? float32 : new Float32Array(0);
  if (!input.length) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i];
  return Math.sqrt(sum / input.length);
}

export function shouldCloseGeminiTurn({
  elapsedMs = 0,
  heardSpeech = false,
  silentMs = 0,
  pushToTalk = false,
  maxMs = MAX_TURN_MS,
  silenceMs = SILENCE_MS,
} = {}) {
  if (elapsedMs >= maxMs) return { close: true, reason: 'max' };
  if (pushToTalk) return { close: false, reason: 'ptt' };
  if (heardSpeech && silentMs >= silenceMs) return { close: true, reason: 'silence' };
  return { close: false, reason: 'continue' };
}

function playBrowserSpeech(text) {
  const spoken = String(text || '').trim();
  if (!spoken || typeof speechSynthesis === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      speechSynthesis.speak(utterance);
    } catch {
      resolve(false);
    }
  });
}

async function playBase64Audio(audio, mimeType) {
  if (!audio) return false;
  try {
    const binary = atob(audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const type = String(mimeType || 'audio/wav').includes('pcm')
      ? 'audio/wav'
      : (mimeType || 'audio/mp3');
    const blob = new Blob([bytes], { type });
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    await new Promise((resolve, reject) => {
      el.onended = resolve;
      el.onerror = reject;
      el.play().catch(reject);
    });
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export class GevGeminiController {
  constructor({ runner, ui, radioLayer = null, dataManager = null, fetchImpl = null } = {}) {
    this.runner = runner;
    this.ui = ui;
    this.radioLayer = radioLayer;
    this.dataManager = dataManager;
    this.fetchImpl = fetchImpl || globalThis.fetch?.bind(globalThis);
    this.status = 'idle';
    this.history = [];
    this.startEpoch = 0;
    this.stream = null;
    this.audioContext = null;
    this.processor = null;
    this.source = null;
    this.chunks = [];
    this.inputRate = TARGET_RATE;
    this.heardSpeech = false;
    this.silentMs = 0;
    this.recordingStartedAt = 0;
    this.pushToTalkMode = false;
    this.pushToTalkKeyHeld = false;
    this.spaceKeyHeld = false;
    this.radioVoiceDucked = false;
    this.turnInFlight = false;
    this.errors = [];
  }

  isActive() {
    return this.status !== 'idle' && this.status !== 'error';
  }

  setStatus(status, detail) {
    this.status = status;
    if (this.ui?.root) this.ui.root.dataset.status = status;
    if (this.ui?.status) this.ui.status.textContent = STATUS[status] || STATUS.idle;
    const resolved = status === 'listening' && this.pushToTalkMode
      ? (this.pushToTalkKeyHeld ? 'Release Space to send' : 'Hold Space to talk')
      : detail;
    const primary = status === 'error'
      ? 'VOICE UNAVAILABLE'
      : (resolved || (status === 'idle' ? 'GEMINI STANDBY' : 'GEMINI ACTIVE'));
    if (this.ui?.detail) {
      this.ui.detail.textContent = primary;
      this.ui.detail.title = primary;
    }
    if (this.ui?.errorDetail) {
      this.ui.errorDetail.textContent = status === 'error'
        ? (resolved || 'Gemini voice session could not be started.')
        : '';
    }
    if (this.ui?.buttonLabel) this.ui.buttonLabel.textContent = 'AERO MIC';
    if (this.ui?.helpDetail) {
      this.ui.helpDetail.textContent = this.pushToTalkMode
        ? (this.pushToTalkKeyHeld
          ? 'Release Space to send'
          : 'Hold Space to speak · tap AERO MIC to toggle Gemini')
        : 'Tap AERO MIC or hold Space — Gemini sends a turn after you pause';
    }
    if (shouldPauseRadioForVoice({ status, pushToTalkKeyHeld: this.pushToTalkKeyHeld })) {
      this.pauseRadioForVoice();
    }
  }

  pauseRadioForVoice() {
    if (!this.radioVoiceDucked) {
      this.radioVoiceDucked = true;
      this.radioLayer?.setVoiceDucked?.(true);
    }
    this.radioLayer?.pause?.({ origin: 'voice-duck' });
  }

  setMicrophoneEnabled(enabled) {
    if (this.ui?.root) this.ui.root.dataset.microphone = enabled ? 'active' : 'muted';
    this.stream?.getAudioTracks?.().forEach((track) => {
      track.enabled = Boolean(enabled);
    });
  }

  async start({ pushToTalk = false } = {}) {
    if (this.isActive()) return;
    this.pauseRadioForVoice();
    const epoch = ++this.startEpoch;
    this.pushToTalkMode = pushToTalk;
    this.pushToTalkKeyHeld = pushToTalk;
    this.history = [];
    this.setStatus('connecting', 'Requesting microphone');
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus('error', 'Microphone support unavailable');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (epoch !== this.startEpoch) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
        return;
      }
      this.setMicrophoneEnabled(!pushToTalk || this.pushToTalkKeyHeld);
      await this.beginCapture();
      if (epoch !== this.startEpoch) return;
      this.setStatus('listening', pushToTalk ? 'Hold Space to talk' : 'Listening — pause to send');
    } catch (error) {
      this.setStatus('error', error?.message || 'Microphone permission denied');
    }
  }

  stop({ preserveStatus = false, preserveRadioPlayback = false } = {}) {
    this.startEpoch += 1;
    this.stopCapture();
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
    this.chunks = [];
    this.heardSpeech = false;
    this.silentMs = 0;
    this.pushToTalkMode = false;
    this.pushToTalkKeyHeld = false;
    this.turnInFlight = false;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    if (!preserveRadioPlayback) {
      this.radioVoiceDucked = false;
      this.radioLayer?.setVoiceDucked?.(false);
    }
    if (!preserveStatus) this.setStatus('idle', 'GEMINI STANDBY');
  }

  async beginCapture() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio is unavailable');
    this.audioContext = new Ctx();
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    this.inputRate = this.audioContext.sampleRate;
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    const bufferSize = 4096;
    this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    this.chunks = [];
    this.heardSpeech = false;
    this.silentMs = 0;
    this.recordingStartedAt = performance.now();
    this.processor.onaudioprocess = (event) => {
      if (!this.isActive() || this.turnInFlight) return;
      if (this.pushToTalkMode && !this.pushToTalkKeyHeld) return;
      const input = event.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
      const level = rmsLevel(input);
      if (level >= SPEECH_RMS) {
        this.heardSpeech = true;
        this.silentMs = 0;
      } else if (this.heardSpeech) {
        this.silentMs += (input.length / this.inputRate) * 1000;
      }
      const elapsedMs = performance.now() - this.recordingStartedAt;
      const decision = shouldCloseGeminiTurn({
        elapsedMs,
        heardSpeech: this.heardSpeech,
        silentMs: this.silentMs,
        pushToTalk: this.pushToTalkMode,
      });
      if (decision.close) void this.flushTurn();
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stopCapture() {
    try { this.processor?.disconnect(); } catch { /* already closed */ }
    try { this.source?.disconnect(); } catch { /* already closed */ }
    try { this.audioContext?.close(); } catch { /* already closed */ }
    this.processor = null;
    this.source = null;
    this.audioContext = null;
  }

  releasePushToTalkKey() {
    if (!this.pushToTalkKeyHeld) return;
    this.pushToTalkKeyHeld = false;
    if (this.ui?.root) delete this.ui.root.dataset.pushToTalk;
    if (!this.pushToTalkMode) return;
    void this.flushTurn();
  }

  concatChunks() {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  async flushTurn() {
    if (this.turnInFlight || !this.isActive()) return;
    const samples = this.concatChunks();
    this.chunks = [];
    this.heardSpeech = false;
    this.silentMs = 0;
    this.recordingStartedAt = performance.now();
    if (samples.length < this.inputRate * 0.25) {
      this.setStatus('listening', this.pushToTalkMode ? 'Hold Space to talk' : 'Listening — pause to send');
      return;
    }
    const downsampled = downsampleToRate(samples, this.inputRate, TARGET_RATE);
    const wav = encodeWavPcm16(downsampled, TARGET_RATE);
    await this.submitTurn({
      audio: bytesToBase64(wav),
      mimeType: 'audio/wav',
    });
  }

  async submitTurn(body) {
    if (this.turnInFlight) return;
    this.turnInFlight = true;
    const epoch = this.startEpoch;
    this.setStatus('executing', 'Sending Gemini turn');
    try {
      const payload = await this.postTurn({
        ...body,
        history: this.history,
      });
      if (epoch !== this.startEpoch) return;
      if (payload.history) this.history = payload.history;
      if (payload.functionCalls?.length) {
        const toolResults = [];
        for (const call of payload.functionCalls) {
          this.setStatus('executing', `Running ${call.name}`);
          let result;
          try {
            result = await this.runner(call.name, call.args || {}, {
              isCurrent: () => epoch === this.startEpoch,
            });
          } catch (error) {
            result = { ok: false, action: call.name, error: error?.message || 'Tool failed' };
          }
          if (shouldStopVoiceAfterRadioTool(result) && result.radioPlaybackRequested) {
            try {
              await this.radioLayer?.playForVoice?.();
            } catch {
              this.radioLayer?.stopPlayback?.({ origin: 'voice-cleanup' });
            }
            this.stop({ preserveRadioPlayback: true });
            return;
          }
          toolResults.push({ name: call.name, response: result });
        }
        this.turnInFlight = false;
        if (epoch !== this.startEpoch) return;
        await this.submitTurn({ toolResults });
        return;
      }
      if (payload.text) {
        this.setStatus('executing', payload.text);
        const played = payload.audio
          ? await playBase64Audio(payload.audio, payload.audioMimeType)
          : false;
        if (!played) await playBrowserSpeech(payload.text);
      }
      if (epoch !== this.startEpoch) return;
      this.setStatus('listening', this.pushToTalkMode ? 'Hold Space to talk' : 'Listening — pause to send');
    } catch (error) {
      if (epoch !== this.startEpoch) return;
      this.setStatus('error', error?.message || 'Gemini turn failed');
    } finally {
      this.turnInFlight = false;
    }
  }

  async postTurn(body) {
    const response = await this.fetchImpl(TURN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Gemini turn failed: HTTP ${response.status}`);
    }
    return data;
  }
}

export function createGevGeminiController(options) {
  if (!options?.runner && options?.viewer) {
    return new GevGeminiController({
      ...options,
      runner: createGevActionRunner(options),
    });
  }
  return new GevGeminiController(options);
}
