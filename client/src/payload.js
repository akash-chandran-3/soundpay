// Reads a SoundPay payload ONLY so the passenger can see what they are paying.
//   SP2|<sessionId>|<routeId>|<amountPaise>|<expiryUnix>|<sig>
//
// This does NOT check the signature. The browser doesn't have the secret, and
// it shouldn't: the server verifies the signature when the passenger approves.
// If someone changed the amount, the screen would show the changed amount but
// the server would reject it with "Invalid payload".
export function readPayload(text) {
  if (typeof text !== 'string') return null;

  const parts = text.trim().split('|');
  if (parts.length !== 6 || parts[0] !== 'SP2') return null;

  const [, sessionId, routeId, amount] = parts;
  if (!/^[0-9]{1,10}$/.test(amount)) return null;

  return { payload: text.trim(), sessionId, routeId, amountPaise: Number(amount) };
}
