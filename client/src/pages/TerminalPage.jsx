// Conductor's terminal: create a ticket, play it as sound, show a QR fallback,
// and poll the server until it says AUTHORIZED, FAILED or EXPIRED.
import { useEffect, useRef, useState } from 'react';
import { createSession, getSessionStatus } from '../api.js';
import { encodeToAudio, getAudioContext, playAudio } from '../sound/ggwave.js';
import { formatPaise } from '../money.js';
import QrCode from '../components/QrCode.jsx';

const MERCHANT_ID = 'BUS-DEPOT-1';
const POLL_MS = 1000;
const GRACE_MS = 5000; // stop polling this long after expiry even if the server is unreachable

export default function TerminalPage() {
  const [routeId, setRouteId] = useState('4B');
  const [amount, setAmount] = useState('25');
  const [volume, setVolume] = useState(0.5);

  // phase: 'idle' -> 'creating' -> 'waiting' -> ('processing') -> 'paid' | 'failed' | 'expired'
  const [phase, setPhase] = useState('idle');
  const [session, setSession] = useState(null);
  const [deadline, setDeadline] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState('');
  const [soundError, setSoundError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [rrn, setRrn] = useState(null); // UPI reference number once paid (simulated)

  const audioRef = useRef(null); // the encoded sound, kept for "Replay"

  async function play() {
    if (!audioRef.current) return;
    setPlaying(true);
    await playAudio(audioRef.current, volume);
    setPlaying(false);
  }

  async function handleGenerate(event) {
    event.preventDefault();
    getAudioContext(); // unlock audio while we are still inside the click

    setError('');
    setSoundError('');
    setPhase('creating');
    audioRef.current = null;

    let created;
    try {
      created = await createSession({ merchantId: MERCHANT_ID, routeId, amount });
    } catch (err) {
      setError(err.message);
      setPhase('idle');
      return;
    }

    setSession(created);
    setDeadline(Date.now() + created.expiresInSeconds * 1000);
    setPhase('waiting');

    // Sound is best-effort: if it fails, the QR code still works.
    try {
      audioRef.current = await encodeToAudio(created.payload);
      await play();
    } catch (err) {
      console.error(err);
      setSoundError('Could not play sound – use the QR code instead.');
    }
  }

  // Countdown (display only; the server decides when it has really expired).
  useEffect(() => {
    if (phase !== 'waiting') return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, deadline]);

  // Poll the server once a second while waiting for, or processing, a payment.
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'processing') return;
    let cancelled = false;

    const id = setInterval(async () => {
      if (Date.now() > deadline + GRACE_MS) {
        setPhase('expired'); // server unreachable for too long: give up
        return;
      }
      try {
        const status = await getSessionStatus(session.sessionId);
        if (cancelled) return; // a late reply after we already stopped
        if (status.status === 'PROCESSING') setPhase('processing');
        if (status.status === 'AUTHORIZED') {
          setRrn(status.rrn);
          setPhase('paid');
        }
        if (status.status === 'FAILED') setPhase('failed');
        if (status.status === 'EXPIRED') setPhase('expired');
      } catch {
        // Network hiccup: just try again on the next tick.
      }
    }, POLL_MS);

    // Runs when phase changes or the page closes: stops this poller
    // (a new one starts if we are still waiting/processing).
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, session, deadline]);

  function reset() {
    setPhase('idle');
    setSession(null);
    setRrn(null);
    audioRef.current = null;
  }

  return (
    <main className="card">
      <h1>Conductor terminal</h1>

      {(phase === 'idle' || phase === 'creating') && (
        <form onSubmit={handleGenerate} className="form">
          <label>
            Route
            <input value={routeId} onChange={(e) => setRouteId(e.target.value)} maxLength={10} required />
          </label>
          <label>
            Fare (₹)
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              required
            />
          </label>
          <label>
            Sound volume ({Math.round(volume * 100)}%)
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
          <button type="submit" disabled={phase === 'creating'}>
            {phase === 'creating' ? 'Creating…' : 'Generate ticket'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      )}

      {session && phase !== 'idle' && phase !== 'creating' && (
        <section className="ticket">
          <p className="amount">
            {formatPaise(session.amountPaise)} · Route {session.routeId}
          </p>

          {phase === 'waiting' && (
            <>
              <p className="countdown">Waiting for passenger… {secondsLeft}s</p>
              <button onClick={play} disabled={playing || !audioRef.current}>
                {playing ? 'Playing sound…' : 'Replay sound'}
              </button>
              {soundError && <p className="error">{soundError}</p>}
              <p className="hint">Can't hear it? Scan this instead:</p>
              <QrCode text={session.payload} />
            </>
          )}

          {phase === 'processing' && (
            <p className="countdown">
              <span className="dot" /> Payment in progress (simulated UPI)…
            </p>
          )}

          {phase === 'paid' && (
            <>
              <p className="status paid">Paid ✓</p>
              {rrn && <p className="hint">UPI RRN {rrn} (simulated)</p>}
              <button onClick={reset}>New ticket</button>
            </>
          )}

          {phase === 'failed' && (
            <>
              <p className="status expired">Payment failed</p>
              <p className="hint">The passenger's (simulated) bank declined it.</p>
              <button onClick={reset}>Generate again</button>
            </>
          )}

          {phase === 'expired' && (
            <>
              <p className="status expired">Expired – generate again</p>
              <button onClick={reset}>Generate again</button>
            </>
          )}
        </section>
      )}
    </main>
  );
}
