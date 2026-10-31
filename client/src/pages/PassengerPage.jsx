// Passenger: listen for the ticket sound (or scan the QR), confirm, enter the
// mock PIN, and let the SERVER decide whether the payment succeeds.
import { useEffect, useRef, useState } from 'react';
import { authorizePayment } from '../api.js';
import { startListening, stopListening } from '../sound/ggwave.js';
import { readPayload } from '../payload.js';
import { formatPaise } from '../money.js';
import QrScanner from '../components/QrScanner.jsx';

const LISTEN_SECONDS = 20;

// Proximity threshold (0..1, same scale as the level meter). A decoded sound is
// only accepted if the average mic level while it played was at least this.
// This is a UX nudge ("hold your phone near the terminal"), NOT security:
// anyone with a louder speaker or a recording can beat it.
const DEFAULT_PROXIMITY_THRESHOLD = 0.3;

// Friendly text for each error the server can send back.
function messageFor(err) {
  switch (err.status) {
    case 400:
      return 'This ticket code is invalid or has been tampered with.';
    case 401:
      return 'Wrong PIN – please try again.';
    case 404:
      return 'Ticket not found. Ask the conductor to generate a new one.';
    case 409:
      return 'This ticket has already been paid.';
    case 410:
      return 'This ticket has expired. Ask the conductor to generate a new one.';
    default:
      return 'Could not reach the server. Check your connection and try again.';
  }
}

function micErrorMessage(err) {
  if (err.name === 'NotAllowedError') {
    return 'Microphone permission denied. Allow mic access in your browser settings, or scan the QR code instead.';
  }
  if (err.name === 'NotFoundError') return 'No microphone found. Scan the QR code instead.';
  if (err.name === 'InsecureContextError') {
    return 'The microphone only works on HTTPS or localhost. Scan the QR code instead.';
  }
  return 'Could not start the microphone. Scan the QR code instead.';
}

export default function PassengerPage() {
  // mode: 'idle' | 'listening' | 'scanning' | 'confirm' | 'paying' | 'paid'
  const [mode, setMode] = useState('idle');
  const [ticket, setTicket] = useState(null); // what readPayload() returned
  const [message, setMessage] = useState(''); // errors and hints
  const [level, setLevel] = useState(0);
  const [threshold, setThreshold] = useState(DEFAULT_PROXIMITY_THRESHOLD);
  const [method, setMethod] = useState('UPI');
  const [pin, setPin] = useState('');

  const thresholdRef = useRef(threshold); // read inside the audio callback
  thresholdRef.current = threshold;

  // Shared by sound and QR: turn raw text into a ticket, or explain why not.
  function handleDecoded(text) {
    const parsed = readPayload(text);
    if (!parsed) {
      setMessage("That doesn't look like a SoundPay ticket.");
      setMode('idle');
      return;
    }
    setTicket(parsed);
    setPin('');
    setMessage('');
    setMode('confirm');
  }

  async function handleListen() {
    setMessage('');
    setLevel(0);
    setMode('listening');

    try {
      // Called directly inside the tap handler: browsers require a user gesture.
      await startListening(
        (text, { averageLevel }) => {
          if (averageLevel < thresholdRef.current) {
            setMessage('Heard a ticket, but it was faint – move closer to the terminal.');
            return; // keep listening
          }
          stopListening(); // mic off as soon as we have a good message
          handleDecoded(text);
        },
        setLevel
      );
    } catch (err) {
      stopListening();
      setMessage(micErrorMessage(err));
      setMode('idle');
    }
  }

  function cancelListening() {
    stopListening();
    setMode('idle');
  }

  // Give up after LISTEN_SECONDS, and always turn the mic off when leaving.
  useEffect(() => {
    if (mode !== 'listening') return;
    const id = setTimeout(() => {
      stopListening();
      setMessage("Didn't hear a ticket. Move closer and tap to listen again, or scan the QR code.");
      setMode('idle');
    }, LISTEN_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [mode]);

  useEffect(() => stopListening, []); // on unmount (e.g. switching to /terminal)

  async function handleApprove(event) {
    event.preventDefault();
    setMessage('');
    setMode('paying');
    try {
      await authorizePayment({ payload: ticket.payload, pin });
      setMode('paid');
    } catch (err) {
      setMessage(messageFor(err));
      // Wrong PIN: let them retry. Anything else: this ticket is finished.
      setMode(err.status === 401 ? 'confirm' : 'idle');
      setPin('');
    }
  }

  function startOver() {
    setTicket(null);
    setMessage('');
    setMode('idle');
  }

  return (
    <main className="card">
      <h1>Passenger</h1>

      {mode === 'idle' && (
        <div className="stack">
          <button onClick={handleListen}>Tap to listen</button>
          <button className="secondary" onClick={() => { setMessage(''); setMode('scanning'); }}>
            Scan QR instead
          </button>
          <details className="settings">
            <summary>Demo settings</summary>
            <label>
              Proximity threshold ({Math.round(threshold * 100)}%) – 0 turns the check off
              <input
                type="range"
                min="0"
                max="0.8"
                step="0.05"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </label>
          </details>
        </div>
      )}

      {mode === 'listening' && (
        <div className="stack center">
          <p className="listening">
            <span className="dot" /> Listening… hold your phone near the terminal
          </p>
          <div className="meter" title="Microphone input level">
            <div className="meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
            <div className="meter-threshold" style={{ left: `${Math.round(threshold * 100)}%` }} />
          </div>
          <button className="secondary" onClick={cancelListening}>Stop</button>
        </div>
      )}

      {mode === 'scanning' && (
        <div className="stack center">
          <QrScanner
            onScan={handleDecoded}
            onError={() => {
              setMessage('Could not open the camera. Check camera permission.');
              setMode('idle');
            }}
          />
          <button className="secondary" onClick={() => setMode('idle')}>Cancel</button>
        </div>
      )}

      {(mode === 'confirm' || mode === 'paying') && ticket && (
        <form className="stack" onSubmit={handleApprove}>
          <p className="amount">
            Pay {formatPaise(ticket.amountPaise)} for Route {ticket.routeId}?
          </p>

          <fieldset className="methods">
            <legend>Payment method (simulated – no real money)</legend>
            {['UPI', 'Wallet'].map((m) => (
              <label key={m} className="radio">
                <input
                  type="radio"
                  name="method"
                  value={m}
                  checked={method === m}
                  onChange={() => setMethod(m)}
                />
                {m} (simulated)
              </label>
            ))}
          </fieldset>

          <label>
            PIN (mock)
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={6}
              required
            />
          </label>

          <button type="submit" disabled={mode === 'paying'}>
            {mode === 'paying' ? 'Approving…' : 'Approve'}
          </button>
          <button type="button" className="secondary" onClick={startOver} disabled={mode === 'paying'}>
            Cancel
          </button>
        </form>
      )}

      {mode === 'paid' && ticket && (
        <div className="stack center">
          <p className="status paid">Paid ✓</p>
          <p className="hint">
            {formatPaise(ticket.amountPaise)} · Route {ticket.routeId} · {method} (simulated)
          </p>
          <button onClick={startOver}>Done</button>
        </div>
      )}

      {message && <p className="error message">{message}</p>}
    </main>
  );
}
