# SoundPay – sound-based bus ticket payment (prototype)

A learning prototype built for an interview demo. **Payments are simulated: no real
money moves, there is no payment gateway, and the PIN is a mock.**

A conductor's **terminal** page encodes a payment request into a short burst of
audible sound. A **passenger** page on a different device listens through the
microphone, decodes it, and asks "Pay ₹25.00 for Route 4B?". The passenger approves
with a mock PIN, and the terminal shows **Paid ✓** within a second or two. If sound
doesn't work, both pages fall back to a QR code carrying the same payload.

## Tech stack

| Part | Tools |
|---|---|
| Frontend | React 19 + Vite, React Router (`/terminal`, `/passenger`) |
| Sound | [`ggwave`](https://github.com/ggerganov/ggwave) (WebAssembly), protocol `GGWAVE_PROTOCOL_AUDIBLE_FAST` |
| QR | `qrcode` (show), `html5-qrcode` (scan) |
| Backend | Node.js + Express 5 |
| Database | MySQL 8 with `mysql2` (plain SQL, parameterised queries, no ORM) |
| Tests | Jest + Supertest, DB layer mocked (no MySQL needed) |

## Architecture

```mermaid
flowchart LR
    subgraph Laptop["Conductor laptop"]
        T["Terminal page<br/>/terminal"]
    end
    subgraph Phone["Passenger phone"]
        P["Passenger page<br/>/passenger"]
    end
    subgraph Server["Laptop: Vite dev server + Express API"]
        V["Vite :5173<br/>(proxies /api)"]
        A["Express :4000<br/>routes → models"]
        PL["payload/<br/>build · parse · HMAC verify"]
    end
    DB[("MySQL<br/>payment_sessions")]

    T -- "POST /api/session/create" --> V
    T -- "GET /api/session/:id/status<br/>(poll every 1 s)" --> V
    P -- "POST /api/session/authorize" --> V
    V --> A
    A --> PL
    A -- "SQL with ? placeholders" --> DB
    T -. "sound (ggwave) or QR<br/>SP1|id|route|paise|expiry|sig" .-> P
```

```mermaid
sequenceDiagram
    participant T as Terminal
    participant API as Express API
    participant DB as MySQL
    participant P as Passenger

    T->>API: POST /create {merchantId, routeId, amount}
    API->>DB: INSERT session (PENDING, expires in 30 s)
    API-->>T: 201 {sessionId, payload}
    T-)P: plays payload as sound (QR as fallback)
    loop every 1 s until AUTHORIZED / EXPIRED
        T->>API: GET /:id/status
    end
    P->>P: decode, check mic level, show "Pay ₹25.00 for Route 4B?"
    P->>API: POST /authorize {payload, pin}
    API->>API: parse + verify HMAC, check PIN
    API->>DB: UPDATE … SET AUTHORIZED WHERE id=? AND status='PENDING' AND expires_at > NOW()
    API-->>P: 200 AUTHORIZED (or 400 / 401 / 409 / 410)
    T->>API: GET /:id/status
    API-->>T: {status: AUTHORIZED} → "Paid ✓"
```

## Folder structure

```
soundpay/
├── server/
│   ├── server.js                 starts the app (checks required .env values)
│   ├── schema.sql                payment_sessions table
│   ├── scripts/initDb.js         npm run db:init
│   ├── src/
│   │   ├── app.js                Express app (no listen, so tests can import it)
│   │   ├── db.js                 mysql2 connection pool
│   │   ├── dbConfig.js           connection settings (+ optional SSL for cloud MySQL)
│   │   ├── validation.js         request checks + rupees → paise
│   │   ├── httpError.js          Error with an HTTP status
│   │   ├── errorHandler.js       404 + central JSON error handler
│   │   ├── models/sessionModel.js   all SQL
│   │   ├── routes/sessionRoutes.js  the 3 endpoints
│   │   └── payload/payload.js    buildPayload / parsePayload / verifySignature
│   └── tests/                    payload.test.js, session.test.js
├── client/
│   ├── vite.config.js            /api proxy, optional HTTPS mode
│   └── src/
│       ├── sound/ggwave.js       ALL ggwave code: encodeToAudio, playAudio, startListening, stopListening
│       ├── pages/TerminalPage.jsx
│       ├── pages/PassengerPage.jsx
│       ├── components/QrCode.jsx, QrScanner.jsx
│       ├── api.js, payload.js, money.js
│       └── styles.css
├── render.yaml                   Render deployment (Blueprint)
├── README.md
└── INTERVIEW_NOTES.md
```

## Setup

> Use a folder path **without special characters** if you can. Characters such as `&`
> break npm's `.cmd` shims on Windows. This project lives under `H&R BLOCK\…`, so its npm
> scripts call `node node_modules/<tool>/…` directly to work around that.

Requirements: Node.js 20+ (built with 22), MySQL 8.

**1. Install**

```bash
cd server
npm install
cd ../client
npm install
```

**2. Configure** – copy `server/.env.example` to `server/.env` and fill it in:

| Variable | Meaning |
|---|---|
| `PORT` | API port (default 4000; the Vite proxy expects 4000) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `PAYLOAD_SECRET` | HMAC key. Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `MOCK_PIN` | The simulated PIN the passenger types (e.g. `1234`) |

**3. Create a MySQL account** (as root, e.g. in MySQL Workbench) – an account that can
only use the `soundpay` database:

```sql
CREATE USER 'soundpay_app'@'localhost' IDENTIFIED BY 'same-as-DB_PASSWORD';
GRANT ALL PRIVILEGES ON soundpay.* TO 'soundpay_app'@'localhost';
```

**4. Create the tables**

```bash
cd server
npm run db:init
```

## Run

Two terminals:

```bash
cd server
npm run dev          # API on http://localhost:4000
```

```bash
cd client
npm run dev          # http://localhost:5173
```

Open http://localhost:5173/terminal and http://localhost:5173/passenger. On one laptop,
the laptop's own mic can hear its speaker; turn the volume up and use "Replay sound".

## Tests

```bash
cd server
npm test
```

55 tests, no MySQL needed (the model module is replaced with `jest.fn()` mocks):

- **payload** – build → parse round trip; tampered amount / route / wrong secret fail
  verification; 13 kinds of malformed strings are rejected; the largest payload stays
  under ggwave's 140-byte limit.
- **create** – valid request 201 (and the payload verifies); rupees → paise conversion;
  bad amount / route 400; invalid JSON 400; DB failure 500 without leaking details.
- **authorize** – success 200; tampered 400; malformed 400; wrong PIN 401 (DB never
  touched); second use 409; expired 410; unknown session 404.
- **status** – PENDING / AUTHORIZED / EXPIRED, 404, non-UUID id 400.
- **dbConfig** – no SSL locally; SSL with certificate checking when `DB_SSL=true`.

Limit of mocked tests: they check the route logic, not the SQL itself. For example,
deleting `AND status = 'PENDING'` from the UPDATE would not fail any test. Integration
tests against a real test database would close that gap.

## Two-device demo (laptop = terminal, phone = passenger)

Browsers only allow the **microphone and camera on HTTPS or `localhost`**. On the
phone, the laptop is not `localhost`, so the phone needs HTTPS. Two ways:

### Option A – self-signed HTTPS on your Wi-Fi (no account needed)

1. Laptop and phone on the **same Wi-Fi** (not a guest network that isolates devices).
2. Start the API as usual (`cd server`, `npm run dev`).
3. Start the client in HTTPS mode:
   ```bash
   cd client
   npm run dev:https
   ```
   Vite prints a `Network:` address, e.g. `https://192.168.1.9:5173/`
   (`ipconfig` → "IPv4 Address" shows the same IP).
4. Windows may ask whether Node.js can use the network – allow it on **Private** networks.
5. Laptop: open `https://localhost:5173/terminal` (accept the certificate warning).
6. Phone: open `https://<laptop-ip>:5173/passenger`. You will see a certificate warning
   because the certificate is self-signed – that is expected for a local prototype:
   - Android Chrome: **Advanced → Proceed to … (unsafe)**
   - iPhone Safari: **Show Details → visit this website**
7. Generate a ticket on the laptop, tap **Tap to listen** on the phone and allow the mic.

Only the Vite server is exposed; it forwards `/api` to Express on the laptop, so the
phone never needs port 4000.

### Option B – a tunnel (real HTTPS certificate)

```bash
cd client
npm run dev
```

In another terminal (after installing [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)):

```bash
cloudflared tunnel --url http://localhost:5173
```

It prints a `https://….trycloudflare.com` address – open `/terminal` and `/passenger` on
it. (`ngrok http 5173` works the same way.) `vite.config.js` already allows these
hostnames. Note this makes your dev server reachable from the internet while the tunnel
runs – stop it after the demo.

### Demo tips

- Sound takes about **5.4 s** to play (76 bytes at ~14 bytes/s), well inside the 30 s window.
- Start listening on the phone **before** the sound plays, or press **Replay sound**.
- Hold the phone 10–50 cm from the laptop speaker. In a noisy room, raise the volume.
- If the level meter stays low, lower the proximity threshold under **Demo settings**
  (0 turns it off). Laptop and phone mics differ a lot.
- If sound fails completely, use **Scan QR instead**.

## Deploy for free (Render + Aiven MySQL)

Render hosts the app for free but has no free MySQL, so the database lives on Aiven's
free MySQL plan. When deployed, **Express also serves the built React app**, so
everything is one HTTPS URL (same origin, no CORS) – and HTTPS means the mic and camera
work on any phone.

```mermaid
flowchart LR
    Phone["Phone / laptop browser"] -- HTTPS --> R["Render web service<br/>Express: /api + built React app"]
    R -- "MySQL over TLS" --> A[("Aiven MySQL")]
```

### 1. Create the database (Aiven)

1. Sign up at [aiven.io](https://aiven.io) → **Create service** → **MySQL** → **Free plan**.
2. When it's running, open the service's **Overview** and note **Host**, **Port**,
   **User** (`avnadmin`) and **Password**, and download the **CA certificate** (`ca.pem`).
   Keep these private – don't commit them.

### 2. Put the code on GitHub

Create an **empty** repository on GitHub (no README), then from the `soundpay` folder:

```bash
git add -A
```
```bash
git commit -m "SoundPay prototype"
```
```bash
git remote add origin https://github.com/<you>/soundpay.git
```
```bash
git push -u origin main
```

`.gitignore` keeps `.env`, `*.local.sql` and certificates out of the repository.

### 3. Deploy on Render

1. Sign up at [render.com](https://render.com) with GitHub → **New** → **Blueprint** →
   pick the repository. Render reads [`render.yaml`](render.yaml).
2. It asks for the values marked secret – paste them from Aiven:
   `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_SSL_CA` (open `ca.pem` in a
   text editor and paste the whole thing, including the BEGIN/END lines).
   `PAYLOAD_SECRET` is generated by Render; `MOCK_PIN` is `1234`; `DB_SSL` is `true`.
3. **Apply**. The build installs everything, builds the client, and runs
   `npm run db:init`, which creates the `soundpay` database and table on Aiven
   (safe to repeat – it uses `IF NOT EXISTS`).
4. Open `https://<your-service>.onrender.com/terminal` on the laptop and
   `https://<your-service>.onrender.com/passenger` on the phone.

Every `git push` to `main` redeploys automatically.

### Free-tier behaviour to expect

- **Cold start:** the free Render service sleeps after ~15 minutes without traffic; the
  next request takes roughly 30–60 s. **Open the site a few minutes before a demo.**
- **Idle database:** free Aiven services can be powered off after a long idle period;
  turn it back on in the Aiven console if the app reports "Something went wrong".
- **Public URL:** anyone with the link can create (simulated) sessions; there is no
  rate limiting.
- Limits change – check Render's and Aiven's current free-plan pages.

## API

All responses are JSON. Errors always look like `{ "error": "message" }`.

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `POST /api/session/create` | `{ merchantId, routeId, amount }` – amount in rupees, > 0, ≤ 1000, max 2 decimals; routeId 1–10 of `A-Z a-z 0-9 -` | **201** `{ sessionId, payload, routeId, amountPaise, expiresInSeconds }` | 400 invalid input |
| `POST /api/session/authorize` | `{ payload, pin }` | **200** `{ status: "AUTHORIZED", sessionId, routeId, amountPaise }` | 400 missing fields / `Invalid payload` (tampered or malformed), 401 `Wrong PIN`, 404 session not found, 409 `Already paid`, 410 `Expired` |
| `GET /api/session/:id/status` | – | **200** `{ status, routeId, amountPaise }` – status is `PENDING`, `AUTHORIZED` or `EXPIRED` | 400 id is not a UUID, 404 not found |
| `GET /api/health` | – | 200 `{ ok: true }` | – |

Any other path → 404 `{ "error": "Not found" }`. Unexpected errors → 500
`{ "error": "Something went wrong" }` (details only in the server log).

## Payload format

```
SP1|<sessionId>|<routeId>|<amountPaise>|<expiryUnix>|<sig>
SP1|3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b|4B|2500|1761040000|9f86d081884c7d65
```

- `SP1` – format version, so the format can change later.
- `sig` – first 16 hex characters of HMAC-SHA256 over everything before it, keyed with
  `PAYLOAD_SECRET`. Compared with `crypto.timingSafeEqual`.
- About 76 bytes; ggwave messages are limited to 140 bytes.

## Security – what this prototype does

- **HMAC signature stops changing the amount.** The signature is computed from the
  session id, route, amount and expiry using a secret only the server has. Change
  `2500` to `100` and the signature no longer matches; making a new valid one needs the
  secret. (Anyone can *read* the payload – HMAC protects integrity, not secrecy.)
- **One atomic UPDATE prevents replay and double payment.**
  `UPDATE … WHERE id=? AND status='PENDING' AND expires_at > NOW()` checks and changes
  the row in one step, so only one request can ever flip it to AUTHORIZED
  (`affectedRows = 1`). A separate SELECT-then-UPDATE would let two requests both see
  PENDING. A replayed payload changes 0 rows and gets 409.
- **30-second expiry limits relay and replay.** A recorded or forwarded payload is
  useless after 30 s, and the expiry is part of the signed data so it can't be extended.
- **The server decides.** The passenger page only *displays* the payload; the terminal
  only shows "Paid ✓" when the database says AUTHORIZED. A modified client can't fake
  that row.
- Parameterised SQL everywhere, a small JSON body limit, input validation, and generic
  500 messages.

## Limitations – what this prototype does NOT solve

- **Anyone nearby can hear the sound.** A nearby passenger could decode the same
  ticket. The **explicit confirmation + PIN** is what prevents accidental charges; the
  proximity (mic level) check is only a UX nudge – a louder speaker or a recording
  beats it.
- **A real-time relay within 30 s is still possible.** Expiry only shortens the window;
  real systems use distance bounding or device-bound cryptography (as NFC payments do).
- **No real payment gateway.** UPI / Wallet are labels only; nothing is charged.
- **The mock PIN is not authentication.** One shared PIN from `.env`, no user accounts,
  no rate limiting or lockout after wrong attempts.
- **The signature is truncated to 64 bits** to keep the sound short. That's acceptable
  here because each payload is single-use and expires in 30 s, but it is a trade-off.
- **No user or merchant authentication on the API** – anyone who can reach it can
  create sessions.
- **Self-signed HTTPS** is for local testing only.
- Expired sessions are marked lazily (when someone asks); there is no cleanup job.
- Uses `ScriptProcessorNode` (deprecated but widely supported) instead of `AudioWorklet`.
