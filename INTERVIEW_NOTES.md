# SoundPay – interview notes

Short answers to the questions you're most likely to get. Say them in your own words,
and point at the code (file names in brackets) while you talk.

## 30-second pitch

"SoundPay is a prototype for paying a bus fare by sound. The conductor's page creates a
payment session on the server and plays a short signed message as audible tones. The
passenger's phone decodes it, shows the fare, and the passenger approves with a PIN.
The server checks the signature, makes the payment single-use with one atomic SQL
update, and the terminal sees 'Paid' by polling. If sound fails, the same message is a
QR code. Payments are simulated – the point was the protocol, security reasoning and
testing, not a real payment integration."

---

### 1. HMAC vs encryption – which did you use and why?

HMAC. Encryption hides data (confidentiality); HMAC proves data wasn't changed and was
made by someone with the secret (integrity + authenticity). The fare isn't secret – the
passenger has to see it – but it must not be changeable. So the payload is readable
plain text plus a signature. Changing `2500` to `100` breaks the signature, and only the
server has the key to make a new one. [`server/src/payload/payload.js`]

Follow-up – *why `timingSafeEqual`?* A normal `===` stops at the first wrong character,
so response time leaks how many leading characters were right. A constant-time
comparison doesn't.

Follow-up – *you cut the HMAC to 16 hex chars?* Yes, 64 bits, to keep the sound short.
Guessing 2^64 values is impractical, especially when each payload is single-use and
lives 30 seconds. With more bandwidth I'd use the full 256 bits.

### 2. What is a replay attack, and how do you stop it?

Someone records a valid message and sends it again later – here, recording the ticket
sound and playing it to pay twice, or reusing someone else's ticket. Three layers:
the payload is tied to one session id, the session can only go PENDING → AUTHORIZED
once (atomic update), and it expires after 30 seconds. A replay gets 409 "Already
paid" or 410 "Expired".

### 3. Why one atomic UPDATE instead of SELECT then UPDATE?

Check-then-update has a race: two requests both SELECT, both see PENDING, both UPDATE –
double payment. Putting the check in the WHERE clause
(`WHERE id=? AND status='PENDING' AND expires_at > NOW()`) makes check and change one
statement. MySQL locks the row; the second request re-evaluates the WHERE after the
first commits, matches nothing, and `affectedRows` is 0. Only then do I SELECT – just to
choose between 409 and 410 for the error message. [`models/sessionModel.js`]

### 4. Why store money as integer paise?

Floats are binary and can't represent most decimals exactly: `0.1 + 0.2` is
`0.30000000000000004`. Rounding errors add up across many transactions. Integers are
exact, so ₹25.50 is stored as `2550` (`INT UNSIGNED`, so negatives are impossible).
Even the rupees → paise conversion avoids float maths: I split the string at the dot
and work with whole numbers. Only the display turns paise back into "₹25.50".
[`validation.js` `rupeesToPaise`, `client/src/money.js`]

### 5. Polling vs WebSockets – why polling?

The terminal asks for the status once a second. A session lasts at most 30 seconds, so
that's ~30 tiny requests per sale – trivial. Polling needs no extra server code, works
through proxies and tunnels, recovers automatically from a dropped request, and is easy
to test. WebSockets (or Server-Sent Events) push instantly and cost less per update;
I'd switch for thousands of terminals or sub-second updates. Polling stops as soon as
the status is AUTHORIZED or EXPIRED. [`TerminalPage.jsx`]

### 6. Why sound? Why not QR or NFC?

| | Sound | QR | NFC |
|---|---|---|---|
| Hardware | Any phone (mic) | Any phone (camera) | Needs an NFC chip |
| Range | ~0.1–1 m, through a crowd | Line of sight, must aim | ~4 cm, tap |
| Speed | ~5 s for our payload | ~1 s | Instant |
| Privacy | Others nearby can hear it | Others can see it | Hard to eavesdrop |
| Web support | Yes (mic + WASM) | Yes | Web NFC only in Chrome on Android |

Sound works in the browser on almost any phone without aiming a camera in a moving
bus; QR is the reliable fallback; NFC is the best real-world option but needs native
apps. That's why the app supports sound with QR as a backup.

### 7. How do microphone permissions work in the browser?

`getUserMedia` only works in a **secure context** (HTTPS or localhost) and needs the
user's permission. The prompt (and audio playback) must come from a user gesture, so
the mic starts only after "Tap to listen". I handle `NotAllowedError` (denied),
`NotFoundError` (no mic) and missing HTTPS with clear messages, turn the mic off after a
successful decode or 20 seconds, and stop the tracks so the mic indicator goes away. I
also disable echo cancellation, noise suppression and auto-gain – they're tuned for
voice and remove the tones. [`client/src/sound/ggwave.js`]

### 8. Why does the server decide, not the client?

Anything in the browser can be changed by the user. The passenger page only *displays*
the decoded amount – it doesn't even have the secret to verify it. The real checks
(signature, PIN, single use, expiry) all happen in `/authorize`, and the terminal shows
"Paid ✓" only when the database row says AUTHORIZED. In my demo I can tamper the amount
to ₹1: the screen shows ₹1.00, but the server rejects it with "Invalid payload".

### 9. What does the 30-second expiry protect against? (relay attacks)

A relay attack forwards a message live to somewhere else – e.g. capturing the ticket
sound and streaming it to a phone elsewhere. The short expiry, which is inside the
signed data so it can't be extended, means a captured payload is useless after 30 s.
It does **not** stop a fast real-time relay; real contactless payments use distance
bounding or device-bound keys for that. I'm honest about it in the README limitations.

### 10. What would you need for real payments?

- A licensed payment gateway / UPI PSP integration instead of a status flip, with
  webhooks and idempotency keys.
- Real user authentication (accounts, UPI PIN entered in the bank's own secure flow,
  device binding), rate limiting and lockouts.
- Merchant/terminal authentication on the API (API keys or mTLS per terminal).
- Proper key management (secret in a vault, key rotation via the `SP1` version).
- An audit log and reconciliation; refunds; a cleanup job for expired sessions.
- HTTPS with real certificates, monitoring, load testing.
- Compliance (RBI guidelines, PCI DSS if cards are involved).

### 11. How did you test it without MySQL? What's the weakness?

The routes only talk to the database through `models/sessionModel.js`, so Jest replaces
that one module with `jest.fn()` mocks, and Supertest calls the Express `app` directly
(`app.js` doesn't call `listen`). 55 tests cover every status code. The weakness: the
SQL itself never runs – removing `AND status = 'PENDING'` wouldn't fail a test. Next
step would be integration tests against a throwaway MySQL database.

### 12. What was hardest / what did you learn?

Getting sound to work reliably: the phone's voice filters removed the tones until I
turned them off; browsers need a user gesture before audio or mic; ggwave's encode
output points into WebAssembly memory that gets overwritten, so it has to be copied.
And keeping the payload short – our 76 bytes already take ~5 seconds of sound.

---

## Numbers to remember

- Payload ≈ 76 bytes (limit 140); sound ≈ 5.4 s with AUDIBLE_FAST
- Session expiry 30 s; terminal polls every 1 s; passenger listens up to 20 s
- Max fare ₹1,000 = 100000 paise; signature 16 hex chars = 64 bits
- 55 server tests

## Demo script (2–3 minutes)

1. Terminal: generate a ₹25 ticket for route 4B – point out the countdown and QR.
2. Phone: Tap to listen → confirmation card → choose UPI (simulated) → wrong PIN (401)
   → right PIN → both screens show Paid ✓.
3. Double payment: open `/passenger` on a second device (or a laptop tab) and let
   both listen to the same ticket. Approve on one, then the other → "already paid"
   (409). This also shows the limitation that anyone nearby can hear the sound.
4. Wait out a ticket → "Expired" on both sides (410).
5. Open `payload.js` and `sessionModel.js` and explain the HMAC and the atomic UPDATE.
6. Run `npm test`.
