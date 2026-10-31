// Every ggwave (data-over-sound) call in the app lives in this one file.
// Pages only use: encodeToAudio(), playAudio(), startListening(), stopListening().
//
// ggwave is a C++ library compiled to WebAssembly. It turns text into a burst of
// audible tones (FSK) with error correction, and back again.
import ggwaveFactory from 'ggwave';

// AUDIBLE_FAST: normal speaker/mic frequencies, so it works on most phones.
// Our ~76-byte payload takes about 5.4 seconds to play with this protocol.
const PROTOCOL = 'GGWAVE_PROTOCOL_AUDIBLE_FAST';
const ENCODE_VOLUME = 50; // ggwave's own volume, 1-100

let ggwavePromise = null; // the WASM module, loaded once
let audioContext = null;
let txInstance = null; // ggwave instance used for sending

// Loads the WASM module the first time it's needed, then reuses it.
function loadGgwave() {
  if (!ggwavePromise) {
    ggwavePromise = ggwaveFactory().then((gg) => {
      gg.disableLog(); // ggwave logs every frame otherwise
      return gg;
    });
  }
  return ggwavePromise;
}

// Browsers only allow audio after a user gesture (a click/tap), so call this
// at the START of a click handler, before any await.
export function getAudioContext() {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

// Tells ggwave the sample rate the browser actually uses (often 44100 or 48000).
function createInstance(gg, sampleRate) {
  const params = gg.getDefaultParameters();
  params.sampleRateInp = sampleRate;
  params.sampleRateOut = sampleRate;
  return gg.init(params);
}

// Text -> AudioBuffer (ready to play, and to replay without re-encoding).
export async function encodeToAudio(text) {
  const gg = await loadGgwave();
  const ctx = getAudioContext();
  if (txInstance === null) txInstance = createInstance(gg, ctx.sampleRate);

  const view = gg.encode(txInstance, text, gg.ProtocolId[PROTOCOL], ENCODE_VOLUME);

  // `view` points into WASM memory that the next encode() overwrites, so copy it.
  // The bytes are 32-bit float samples, which is what Web Audio wants.
  const bytes = new Int8Array(view);
  const samples = new Float32Array(bytes.buffer);

  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

// Plays an AudioBuffer. gain 0..1 (lower = quieter = passenger must be closer).
// Resolves when playback has finished.
export function playAudio(buffer, gain = 0.5) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  const volume = ctx.createGain();

  source.buffer = buffer;
  volume.gain.value = gain;
  source.connect(volume).connect(ctx.destination);

  return new Promise((resolve) => {
    source.onended = resolve;
    source.start();
  });
}

// ---------------------------------------------------------------------------
// Receiving (passenger side)
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 1024; // samples per callback (~21 ms at 48 kHz)
const LEVEL_WINDOW_SECONDS = 5; // about as long as one message takes to play

let listening = null; // everything we need to undo in stopListening()
let attempt = 0; // bumped by every start/stop, so a slow start can tell it was cancelled

// Converts a chunk of samples to a 0..1 loudness value.
// RMS = "average energy"; dB maps it to a scale closer to how we hear:
// -60 dB (very quiet) -> 0, 0 dB (as loud as possible) -> 1.
function chunkLevel(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  const db = 20 * Math.log10(rms || 1e-9);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

// Turns on the mic and decodes ggwave messages.
//   onMessage(text, { averageLevel })  - a message was decoded
//   onLevel(level)                     - called ~every 20 ms with the input level (0..1)
// averageLevel is the mean input level over the last ~5 s, i.e. while the
// message was playing. The page uses it for the "are you close enough?" check.
//
// MUST be called from a tap/click handler (browsers require a user gesture).
// Throws if the mic is unavailable or permission is denied.
export async function startListening(onMessage, onLevel = () => {}) {
  stopListening(); // never run two listeners at once
  const myAttempt = ++attempt;

  const ctx = getAudioContext(); // first, while we are still in the tap handler
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('Microphone needs HTTPS or localhost');
    err.name = 'InsecureContextError';
    throw err;
  }

  // Turn OFF the phone's voice-call filters: they treat our tones as noise
  // and remove them, which breaks decoding.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });

  const gg = await loadGgwave();

  // stopListening() was called while we waited for permission: undo and quit.
  if (myAttempt !== attempt) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }

  const rxInstance = createInstance(gg, ctx.sampleRate); // fresh decoder state each time

  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated in favour of AudioWorklet, but it is still
  // supported everywhere and is far simpler (ggwave's own web demo uses it).
  const processor = ctx.createScriptProcessor(CHUNK_SIZE, 1, 1);
  // Chrome only runs the processor if it is connected to the output. A gain of 0
  // keeps it running without playing the mic back through the speaker.
  const mute = ctx.createGain();
  mute.gain.value = 0;

  const windowSize = Math.ceil((LEVEL_WINDOW_SECONDS * ctx.sampleRate) / CHUNK_SIZE);
  const recentLevels = [];

  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);

    const level = chunkLevel(samples);
    recentLevels.push(level);
    if (recentLevels.length > windowSize) recentLevels.shift();
    onLevel(level);

    // ggwave wants raw bytes; copy the floats and hand over their bytes.
    const bytes = new Int8Array(new Float32Array(samples).buffer);
    const result = gg.decode(rxInstance, bytes);

    if (result && result.length > 0) {
      const text = new TextDecoder('utf-8').decode(result);
      const averageLevel = recentLevels.reduce((a, b) => a + b, 0) / recentLevels.length;
      onMessage(text, { averageLevel });
    }
  };

  source.connect(processor);
  processor.connect(mute).connect(ctx.destination);

  listening = { gg, rxInstance, stream, source, processor, mute };
}

// Turns the mic off and frees the decoder. Safe to call at any time.
export function stopListening() {
  attempt++; // cancels a start that is still waiting for mic permission
  if (!listening) return;
  const { gg, rxInstance, stream, source, processor, mute } = listening;
  listening = null;

  processor.onaudioprocess = null;
  source.disconnect();
  processor.disconnect();
  mute.disconnect();
  stream.getTracks().forEach((track) => track.stop()); // mic indicator goes off
  gg.free(rxInstance);
}
