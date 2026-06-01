# ⚡ IVAC Automation System

> Full end-to-end automation for Indian Visa Application Center (IVAC) Bangladesh — Registration → File Upload → Slot Monitoring → Appointment Booking → Payment  
> **Package version:** 2.0.0 (see `package.json`)

---

## 📋 Overview

This system automates the complete IVAC visa appointment process:

1. **Extract** — Parse applicant data from BGD PDF form automatically
2. **Register** — Create IVAC account with OTP verification
3. **Upload** — Upload BGD form, photo, supporting documents, and optional group attendees (extra BGD PDFs)
4. **Monitor** — Aggressively poll for appointment slots around the configured BD-time window (default 5:00 PM Asia/Dhaka)
5. **Book** — Instantly grab available slots before competitors
6. **Pay** — Initiate visa processing fee payment (manual completion on SSLCommerz)

Supports both **Full Pipeline** (BGD PDF → everything automated) and **Existing Account** (login + slot booking) modes — identical to ninza.live's workflow.

---

## Implementation status


| Area                                                            | Status          | Notes                                                                         |
| --------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| Express API, pipeline orchestration, Mongo models               | Done            | `src/api`, `src/services/pipeline.js`                                         |
| Playwright launch + Dhaka context / proxy                       | Done            | `src/modules/browser.js`                                                      |
| Stealth (`playwright-extra` + `puppeteer-extra-plugin-stealth`) | Done            | Same file; not a guarantee against IVAC                                       |
| Central selectors                                               | Done            | `src/ivac/pageObjects.js` — update only here when the site changes            |
| Captcha (2Captcha / AntiCaptcha)                                | Done            | `captchaSolver.js`; set `CAPTCHA_SERVICE` + matching API key; SSLCommerz gateway included |
| Pipeline concurrency cap (HTTP 503 when saturated)              | Done            | `p-queue` in `src/services/pipelineQueue.js`                                  |
| API validation (Joi)                                            | Done            | `src/api/validation/applicationSchemas.js`                                    |
| Dashboard socket subscribe + status styles + BD clock           | Done            | `dashboard/index.html`                                                        |
| Multi-agent API key auth + tenant scoping                        | Done            | `src/api/middleware/auth.js`, `src/api/models/agent.js`                       |
| Auth-gated uploads download                                      | Done            | `src/api/routes/uploads.js` (`/api/uploads/:type/:filename`)                  |
| Redis + Bull queue                                               | Not implemented | Optional scale path; add worker if you need distributed jobs                  |


---

## 🗂️ Project Structure

```
ivac-automation/
├── src/
│   ├── ivac/
│   │   └── pageObjects.js           # Central IVAC selectors + DOM helpers
│   ├── config/
│   │   └── config.js              # All configuration (env-driven)
│   ├── modules/
│   │   ├── browser.js             # Playwright-extra + stealth browser manager
│   │   ├── captchaSolver.js       # 2Captcha / AntiCaptcha integration
│   │   ├── registration.js        # IVAC account registration
│   │   ├── login.js               # Login + session management
│   │   ├── fileUploader.js        # Document upload handler
│   │   ├── slotBooker.js          # ⚡ Competitive slot monitor & booker
│   │   ├── payment.js             # Payment processing (SSLCommerz/bKash)
│   │   └── otpHandler.js          # Multi-source OTP retrieval
│   ├── services/
│   │   ├── pipeline.js            # 🚀 End-to-end orchestrator
│   │   ├── pipelineQueue.js       # p-queue: limits concurrent pipelines
│   │   ├── pdfExtractor.js        # BGD PDF data extraction
│   │   ├── notifier.js            # Telegram + Email notifications
│   │   └── logger.js              # Winston structured logging
│   └── api/
│       ├── server.js              # Express + Socket.IO server
│       ├── models/
│       │   └── application.js     # MongoDB application model
│       │   └── agent.js           # Agent accounts (API key auth)
│       ├── middleware/
│       │   └── auth.js            # API key middleware (multi-agent)
│       ├── validation/
│       │   └── applicationSchemas.js # Joi schemas for pipeline bodies
│       └── routes/
│           ├── applications.js    # Application CRUD + pipeline triggers
│           └── slots.js           # Active slot monitors API
│           ├── uploads.js         # Auth-gated file downloads
│           └── agents.js          # GET /api/agents/me
├── scripts/
│   ├── slotMonitor.js             # Standalone CLI slot monitor
│   └── testConnection.js         # MongoDB smoke test (`npm run preflight`)
│   └── seedAgent.js              # Create agent API keys
├── dashboard/
│   └── index.html                 # Real-time web dashboard (served at `/` and `/dashboard`)
├── uploads/
│   ├── bgd/                       # Uploaded BGD PDFs
│   ├── photos/                    # Uploaded applicant photos
│   └── documents/                 # Reserved / created by server at startup
├── logs/                          # Application logs
├── .env.example                   # Environment config template
└── package.json
```

### Maintaining selectors when IVAC changes

Run `npx playwright codegen https://www.ivacbd.com/login` (or the page that broke), compare with live DOM, and update **only** `src/ivac/pageObjects.js` — keep fallback chains for flaky markup.

---

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18
- MongoDB (local or Atlas)
- **No Redis required** for the current in-process pipeline; Redis/Bull are an optional future for a distributed worker

### 1. Install

```bash
git clone <repo>
cd ivac-automation
npm install
npm run install-browsers
```

(`install-browsers` runs `npx playwright install chromium`.)

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your settings
```

Minimum to get started (extend using `.env.example` for production):

```env
MONGODB_URI=mongodb://localhost:27017/ivac_automation
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id
MIMSMS_API_KEY=your_mimsms_api_key
MIMSMS_API_TOKEN=your_mimsms_api_token
MIMSMS_VIRTUAL_NUMBER=2347015272
OTP_WEBHOOK_SECRET=your_webhook_secret
```

### 3. Verify database

```bash
npm run preflight
npm test
# or both:
npm run test:all
```

### 4. Start server

```bash
npm start
# Dev with reload: npm run dev
```

- **Dashboard (UI):** `http://localhost:3000/` (root `GET /` serves `dashboard/index.html`)
- **Static mount:** `http://localhost:3000/dashboard/…`
- **API base:** `http://localhost:3000/api`

### 5. NPM scripts


| Script             | Command                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `start`            | Start API + dashboard                                             |
| `dev`              | Same with nodemon                                                 |
| `preflight`        | MongoDB connectivity smoke test                                   |
| `test`             | Unit tests (`tests/pageObjects.test.js`)                          |
| `test:all`         | `preflight` + `test` (use before release when Mongo is reachable) |
| `slot-monitor`     | CLI wrapper → `scripts/slotMonitor.js`                            |
| `install-browsers` | Install Playwright Chromium                                       |


### 6. Standalone slot monitor (CLI)

```bash
npm run slot-monitor -- \
  --phone 01XXXXXXXXX \
  --password "MyPass@123" \
  --location "Dhaka (Gulshan)" \
  --visa Tourist
```

Optional: `--max-attempts 100` to stop after N tries (default: unlimited until success or Ctrl+C).

Slot window timing (pre-warm, hour, minute, timezone) is controlled by `IVAC_*` variables in `.env` (see [Environment variables](#-environment-variables-reference)).

---

## 🏥 Health

```http
GET /health
```

Returns JSON including MongoDB connection state, `activeBrowsers`, `activeMonitors`, `pipelineQueueWaiting`, `pipelineQueueConcurrency`, and `uptime`. Use for load balancers or ops checks.

---

## 🔌 API Reference

### Authentication (required)

All `/api/*` endpoints (except `POST /api/otp/webhook`) require an **Agent API key**.

- Header: `X-API-Key: <agent_api_key>` (or `Authorization: Bearer <agent_api_key>`)
- Create an agent key: `node scripts/seedAgent.js "Agent Name"`

### Start full pipeline

```http
POST /api/applications/full-pipeline
Content-Type: multipart/form-data
```

**202 Accepted** — pipeline runs asynchronously; response includes `applicationId` and `pipelineId`.

**503 Service Unavailable** — returned when the pipeline wait queue is saturated (`PIPELINE_QUEUE_MAX_WAITING`); retry after a short backoff.


| Field                                  | Type          | Notes                                                |
| -------------------------------------- | ------------- | ---------------------------------------------------- |
| `bgdPdf`                               | file          | **Required** — main BGD PDF                          |
| `photo`                                | file          | Optional                                             |
| `ivacPassword`                         | string        | **Required**                                         |
| `ivacLocation`                         | string        | **Required** — must match a known centre (see below) |
| `visaType`                             | string        | **Required** — e.g. `Tourist`                        |
| `paymentMode`                          | string        | `self` or `manual` (default `self`)                  |
| `preferredDates`                       | string (JSON) | e.g. `["15/06/2026","16/06/2026"]`                   |
| `attendee1Pdf` … `attendee3Pdf`        | files         | Optional extra BGD PDFs for group booking            |
| `attendee1Name`, `attendee1Passport` … | strings       | Optional metadata per attendee                       |


### Start existing-account pipeline

```http
POST /api/applications/existing-account
Content-Type: application/json
```

**202 Accepted**

```json
{
  "ivacPhone": "01XXXXXXXXX",
  "ivacPassword": "MyPass@123",
  "ivacEmail": "user@example.com",
  "ivacLocation": "Dhaka (Gulshan)",
  "visaType": "Tourist",
  "paymentMode": "self",
  "preferredDates": ["15/06/2026"],
  "attendees": []
}
```

### List applications

```http
GET /api/applications?status=MONITORING_SLOTS&date=2026-05-01&page=1&limit=20
```

- `date` — filter documents created on that calendar day (server-local interpretation of the date string)

### Application logs

```http
GET /api/applications/:id/logs
```

Returns stored `logs` array and current `status`.

### Get application

```http
GET /api/applications/:id
```

### Stop monitor

```http
POST /api/applications/:id/stop
```

Stops slot monitoring for that application and sets status to `STOPPED`.

### Slot monitors (global)

```http
GET /api/slots/monitors
```

Returns all active monitors from `slotBooker` (for operations/debugging).

```http
DELETE /api/slots/monitors/:applicationId
```

Stops the monitor for the given `applicationId` (same ID used internally by the slot booker).

### Submit OTP manually

```http
POST /api/otp/manual
Content-Type: application/json

{ "phone": "01XXXXXXXXX", "otp": "123456" }
```

### OTP webhook (from SMS forwarder / OTP server)

```http
POST /api/otp/webhook
Content-Type: application/json

{ "phone": "01XXXXXXXXX", "message": "Your IVAC OTP is 123456", "apiKey": "same_as_OTP_WEBHOOK_SECRET_or_OTP_SERVER_API_KEY" }
```

- In **production**, `OTP_WEBHOOK_SECRET` or `OTP_SERVER_API_KEY` must be set; otherwise the endpoint returns **503** (`Webhook not configured`).
- If a secret is set, `apiKey` in the body must match (timing-safe comparison).

### Stats

```http
GET /api/applications/stats/summary
```

Includes aggregate counts and `activeMonitors`.

---

## 📍 Allowed IVAC locations (`ivacLocation`)

Values must match exactly (from `src/config/config.js`):

`Dhaka (Gulshan)`, `Dhaka (Jamuna Future Park)`, `Dhaka (Dhanmondi)`, `Chittagong`, `Rajshahi`, `Sylhet`, `Khulna`, `Jessore`, `Barisal`, `Mymensingh`, `Rangpur`, `Comilla`

**Visa types** supported in config include: Tourist, Medical, Business, Student, Employment, Conference, Research, Transit, Entry (X), Visit.

---

## 📡 Realtime (Socket.IO)

The server attaches Socket.IO for the dashboard. Clients can emit `subscribe` with an `applicationId` to join room `app:<applicationId>`. Events include `pipelineUpdate`, `slotBooked`, `slotsFound` (payload shapes depend on pipeline state).

---

## ⚙️ OTP setup options

Bangladesh production uses **MiMSMS inbound SMS polling** as the primary OTP source, with an **Android SMS forwarder webhook** as fallback. Manual OTP is for development/admin only.

### Option 1: MiMSMS (primary — recommended for production)

Register at [MiMSMS](https://www.mimsms.com.bd/) and obtain your API key, API token, and dedicated virtual number. Configure:

```env
MIMSMS_API_KEY=your_api_key
MIMSMS_API_TOKEN=your_api_token
MIMSMS_VIRTUAL_NUMBER=2347015272
MIMSMS_INBOX_LIST=unread
MIMSMS_POLL_INTERVAL_MS=3000
```

The pipeline polls `GET https://www.mimsms.com.bd/smsAPI?getinbox` every 2–3 seconds, filters messages by your virtual number (`to`) and timestamp (after the pipeline started waiting), and extracts the 6-digit OTP from the SMS body.

**MiMSMS policy:** only the most recent message is returned per request; messages are available for 24 hours and each message can be fetched once. Poll frequently during the 5 PM slot rush.

### Option 2: Android SMS forwarder webhook (fallback)

Point an Android SMS forwarder app at your server:

```env
OTP_WEBHOOK_SECRET=your_shared_secret
```

```http
POST /api/otp/webhook
{ "phone": "01XXXXXXXXX", "message": "Your IVAC OTP is 123456", "apiKey": "same_as_OTP_WEBHOOK_SECRET" }
```

This runs in parallel with MiMSMS polling — whichever delivers first wins.

### Option 3: Self-hosted OTP server (optional)

Deploy [diptosaya2010-web/otp-server](https://github.com/diptosaya2010-web/otp-server):

```env
OTP_SERVER_URL=https://your-otp-server.com
OTP_SERVER_API_KEY=your_key
```

### Option 4: Manual (development / admin only)

Use `POST /api/otp/manual` when `OTP_ALLOW_MANUAL=true` or in non-production. **Do not expose this to agency clients** — pipelines fail with a clear error if all automated sources time out.

---

## 🎯 Slot booking strategy

The `slotBooker.js` module uses a multi-layered competitive strategy. **Default** slot open time is **17:00** in `Asia/Dhaka`, with **30s** pre-warm — all configurable via env.


| Phase      | Timing                                                                                   | Check interval      |
| ---------- | ---------------------------------------------------------------------------------------- | ------------------- |
| Pre-warm   | Opens at `IVAC_SLOT_OPEN_HOUR`:`IVAC_SLOT_OPEN_MINUTE` minus `IVAC_SLOT_PREWARM_SECONDS` | Session preparation |
| Aggressive | First 20 attempts                                                                        | 3–5 seconds         |
| Normal     | Attempts 21–50                                                                           | 5–10 seconds        |
| Relaxed    | 50+ attempts                                                                             | 10–20 seconds       |


**Key competitive advantages:**

- Waits until the configured BD-time window with configurable pre-warm
- **playwright-extra** + stealth plugin (reduces common automation signals; IVAC may still block or challenge)
- Multiple concurrent sessions supported — bounded by `MAX_CONCURRENT_BROWSERS` (browser pool) and `QUEUE_CONCURRENCY` / `PIPELINE_QUEUE_MAX_WAITING` (accepted API jobs)
- Session usage tuned for monitor loop (fresh login per attempt in monitor mode)
- Random jitter to reduce rate limiting
- Real-time Telegram alert on slot found

---

## 📱 Notification setup (Telegram)

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get your Chat ID via [@userinfobot](https://t.me/userinfobot)
3. Set in `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABCdef...
TELEGRAM_CHAT_ID=-1001234567890
```

**Email:** configure `SMTP_`* and `NOTIFY_EMAIL` in `.env` for Nodemailer-based alerts (see `.env.example`).

Notifications are sent for major pipeline events (slot booked, payment required, failures, monitor started — see `src/services/notifier.js`).

---

## 🧩 Captcha solving (2Captcha / AntiCaptcha)

IVAC and the SSLCommerz gateway can show reCAPTCHA v2. The pipeline calls `captchaSolver.ensureResolved()` on registration, login, slots, payment, and after redirect to SSLCommerz.

```env
# Default provider
CAPTCHA_SERVICE=2captcha
TWOCAPTCHA_API_KEY=your_2captcha_key

# Or Anti-Captcha:
# CAPTCHA_SERVICE=anticaptcha
# ANTICAPTCHA_API_KEY=your_anticaptcha_key
```

In **production**, the server refuses to start unless the API key for your chosen `CAPTCHA_SERVICE` is set. If a challenge appears at runtime without a key, the step fails with a clear error (non-production may log a warning and continue).

---

## 🔒 Anti-detection (what is actually wired)

These mitigations **help** but **do not guarantee** uninterrupted access; IVAC can change rules, show captchas, or block by IP at any time.

- **playwright-extra** Chromium with **puppeteer-extra-plugin-stealth** (see `src/modules/browser.js`)
- Randomized user agents and BD timezone / locale context; optional `PROXY_LIST`
- Optional **image/font blocking** via `BLOCK_MEDIA` / `SLOT_MONITOR_BLOCK_MEDIA` (tradeoff: faster but sometimes less “typical”)
- Human-ish delays and typing in automation modules; tracing/screenshots on failure when `TRACE_ON_FAILURE` / `DEBUG_PW` are set
- **Captcha solving** via `CAPTCHA_SERVICE` (`2captcha` or `anticaptcha`) in `src/modules/captchaSolver.js`, including SSLCommerz after redirect

---

## 🗄️ Application status flow

```
PENDING → PROCESSING → EXTRACTING_PDF → REGISTERING → LOGGING_IN
        → UPLOADING_FILES → MONITORING_SLOTS
        → SLOT_BOOKED → PROCESSING_PAYMENT → COMPLETED
                                            → PAYMENT_PENDING / AWAITING_PAYMENT
        → SLOT_NOT_FOUND
        → FAILED
        → STOPPED   (manual stop)
```

---

## 🛠️ Environment variables reference

See `.env.example` for the full template. Summary:


| Area                        | Variables                                                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App**                     | `NODE_ENV`, `PORT`, `HOST`, `JWT_SECRET`                                                                                                                                                                                                      |
| **MongoDB**                 | `MONGODB_URI`, `MONGODB_SERVER_SELECTION_TIMEOUT_MS`, `MONGODB_SOCKET_TIMEOUT_MS`, `MONGODB_MAX_POOL_SIZE`                                                                                                                                    |
| **Queues (in-process)**     | `QUEUE_CONCURRENCY`, `PIPELINE_QUEUE_MAX_WAITING` — saturate → API **503**                                                                                                                                                                    |
| **Future: Redis / Bull**    | Not in use; uncomment `REDIS_URL` in `.env` only when you add a distributed worker                                                                                                                                                            |
| **HTTP / security**         | `TRUST_PROXY`, `CORS_ORIGINS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `WEBHOOK_RATE_LIMIT_MAX`                                                                                                                                             |
| **IVAC URLs & slot timing** | `IVAC_BASE_URL`, `IVAC_ONLINE_URL`, `IVAC_LOGIN_URL`, `IVAC_SLOT_CHECK_INTERVAL`, `IVAC_SLOT_OPEN_HOUR`, `IVAC_SLOT_OPEN_MINUTE`, `IVAC_SLOT_PREWARM_SECONDS`, `IVAC_TIMEZONE`                                                                |
| **OTP**                     | `MIMSMS_API_KEY`, `MIMSMS_API_TOKEN`, `MIMSMS_VIRTUAL_NUMBER`, `MIMSMS_INBOX_LIST`, `MIMSMS_POLL_INTERVAL_MS`, `OTP_WEBHOOK_SECRET`, `OTP_WAIT_TIMEOUT`, `OTP_POLL_INTERVAL`, `OTP_SERVER_URL`, `OTP_SERVER_API_KEY`, `OTP_ALLOW_MANUAL` |
| **Captcha**                 | `CAPTCHA_SERVICE`, `TWOCAPTCHA_API_KEY`, `ANTICAPTCHA_API_KEY`                                                                                                                                                                                |
| **Notifications**           | `SMTP_`*, `NOTIFY_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`                                                                                                                                                                            |
| **Browser & retries**       | `HEADLESS`, `BROWSER_TIMEOUT`, `SLOW_MO`, `PROXY_LIST`, `MAX_CONCURRENT_BROWSERS`, `BLOCK_MEDIA`, `SLOT_MONITOR_BLOCK_MEDIA`, `TRACE_ON_FAILURE`, `DEBUG_PW`, `QUEUE_CONCURRENCY`, `PIPELINE_QUEUE_MAX_WAITING`, `MAX_RETRIES`, `RETRY_DELAY` |
| **Payment**                 | `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWD`, `SSLCOMMERZ_SANDBOX`, `BKASH_`*, `CARD_`*                                                                                                                                                   |


*Automated OTP via webhook requires secrets in production, as described above.*

---

## ⚠️ Legal notice

This tool is intended for **authorized agents and visa consultants** who assist clients with IVAC appointment scheduling. Users are responsible for compliance with IVAC's terms of service. Do not use this tool to fraudulently obtain slots or scalp appointments. IVAC has explicitly warned against fraudulent appointment slot offers.

---

## 📝 License

MIT License — as documented here; this workspace does not yet include a root `LICENSE` file or `license` entry in `package.json` (add those when publishing).