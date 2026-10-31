// Passenger: listen for the ticket sound (or scan the QR), confirm, pick a
// demo UPI account, enter the mock PIN, and let the SERVER decide whether the
// (simulated) UPI payment succeeds.
import { useEffect, useRef, useState } from 'react';
import { authorizePayment, getDemoAccounts } from '../api.js';
import { startListening, stopListening } from '../sound/ggwave.js';
import { readPayload } from '../payload.js';
import { formatPaise } from '../money.js';
import QrScanner from '../components/QrScanner.jsx';
import UpiTimeline from '../components/UpiTimeline.jsx';

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
    case 402:
      return `Payment declined by the bank (simulated): ${err.message}.`;
    case 404:
      return 'Ticket not found. Ask the conductor to generate a new one.';
    case 409:
      return `${err.message}.`; // already paid / in progress / failed earlier
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
  // mode: 'idle' | 'listening' | 'scanning' | 'confirm' | 'paying' | 'paid' | 'declined'
  const [mode, setMode] = useState('idle');
  const [ticket, setTicket] = useState(null); // what readPayload() returned
  const [message, setMessage] = useState(''); // errors and hints
  const [level, setLevel] = useState(0);
  const [threshold, setThreshold] = useState(DEFAULT_PROXIMITY_THRESHOLD);
  const [accounts, setAccounts] = useState([]); // simulated UPI accounts from the server
  const [payerVpa, setPayerVpa] = useState('kesav@mockbank');
  const [pin, setPin] = useState('');
  const [receipt, setReceipt] = useState(null); // server's reply after a payment attempt

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

  // Load the demo payer accounts once.
  useEffect(() => {
    getDemoAccounts()
      .then((data) => setAccounts(data.accounts))
      .catch(() => {}); // keep the default account if this fails
  }, []);

  async function handleApprove(event) {
    event.preventDefault();
    setMessage('');
    setMode('paying');
    try {
      const result = await authorizePayment({ payload: ticket.payload, pin, payerVpa });
      setReceipt(result); // includes the RRN and the UPI steps
      setMode('paid');
    } catch (err) {
      setPin('');
      if (err.status === 402) {
        // Declined by the (simulated) bank: show how far the transfer got.
        setReceipt(err.data);
        setMessage(messageFor(err));
        setMode('declined');
        return;
      }
      setMessage(messageFor(err));
      // Wrong PIN: let them retry. Anything else: this ticket is finished.
      setMode(err.status === 401 ? 'confirm' : 'idle');
    }
  }

  function startOver() {
    setTicket(null);
    setReceipt(null);
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
            <legend>Pay with UPI from (simulated demo accounts – no real money)</legend>
            {(accounts.length ? accounts : [{ vpa: payerVpa, name: 'Demo account' }]).map((a) => (
              <label key={a.vpa} className="radio">
                <input
                  type="radio"
                  name="payerVpa"
                  value={a.vpa}
                  checked={payerVpa === a.vpa}
                  onChange={() => setPayerVpa(a.vpa)}
                />
                <span>
                  {a.vpa}
                  {a.balancePaise !== undefined && (
                    <span className="hint"> · balance {formatPaise(a.balancePaise)}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          <label>
            UPI PIN (mock)
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
            {mode === 'paying' ? 'Processing UPI payment…' : 'Approve'}
          </button>
          <button type="button" className="secondary" onClick={startOver} disabled={mode === 'paying'}>
            Cancel
          </button>
        </form>
      )}

      {mode === 'paid' && receipt && (
        <div className="stack">
          <p className="status paid center-text">Paid ✓</p>
          <p className="hint center-text">
            {formatPaise(receipt.amountPaise)} · Route {receipt.routeId}
            <br />
            {receipt.payerVpa} → {receipt.payeeVpa}
            <br />
            RRN <strong>{receipt.rrn}</strong> (simulated)
          </p>
          <UpiTimeline steps={receipt.steps} />
          <button onClick={startOver}>Done</button>
        </div>
      )}

      {mode === 'declined' && receipt && (
        <div className="stack">
          <p className="status expired center-text">Payment declined</p>
          {receipt.steps && <UpiTimeline steps={receipt.steps} />}
          <p className="hint">Ask the conductor for a new ticket to try again.</p>
          <button onClick={startOver}>Done</button>
        </div>
      )}

      {message && <p className="error message">{message}</p>}
    </main>
  );
}
