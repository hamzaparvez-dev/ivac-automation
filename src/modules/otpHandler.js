// src/modules/otpHandler.js
// OTP retrieval (Bangladesh production):
// 1. MiMSMS inbound SMS polling (primary)
// 2. POST /api/otp/webhook — Android SMS forwarder (fallback, in-memory buffer + pending)
// 3. Optional self-hosted OTP server poll
// 4. Manual POST /api/otp/manual — development / admin only (OTP_ALLOW_MANUAL)
const axios = require('axios');
const config = require('../config/config');
const logger = require('../services/logger');

class OtpHandler {
  constructor() {
    this.pending = new Map(); // phone -> { resolve, reject, timer }
    this.buffer = new Map(); // phone -> { otp, expiresAt }
    this.bufferTtlMs = 60_000;
    /** MiMSMS message IDs already consumed (each message is fetch-once) */
    this.processedMessageIds = new Set();
  }

  _pruneBuffer(now = Date.now()) {
    for (const [phone, entry] of this.buffer.entries()) {
      if (!entry || entry.expiresAt <= now) this.buffer.delete(phone);
    }
  }

  _consumeBufferedOtp(phone) {
    this._pruneBuffer();
    const entry = this.buffer.get(phone);
    if (!entry) return null;
    this.buffer.delete(phone);
    return entry.otp;
  }

  _cancelPending(phone) {
    const pending = this.pending.get(phone);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(phone);
  }

  _isMiMSMSConfigured() {
    const m = config.otp.mimsms;
    return !!(m?.apiKey && m?.apiToken && m?.virtualNumber);
  }

  /**
   * Wait for OTP for a given phone number.
   * @param {string} phone - BD phone number (01XXXXXXXXX)
   * @param {number} timeout - Max wait in ms
   */
  async waitForOtp(phone, timeout = config.otp.waitTimeout) {
    logger.info(`Waiting for OTP on phone: ${phone}`);

    const normalizedPhone = this._normalizePhone(phone);

    const buffered = this._consumeBufferedOtp(normalizedPhone);
    if (buffered) {
      logger.info(`Using buffered OTP for ${normalizedPhone}`);
      return buffered;
    }

    const waitStart = Date.now();
    const runners = [];

    // Webhook / manual admin delivery (Android SMS forwarder fallback)
    runners.push(this._waitForPendingDelivery(normalizedPhone, timeout));

    if (this._isMiMSMSConfigured()) {
      runners.push(this._pollMiMSMS(normalizedPhone, waitStart, timeout));
    }

    if (config.otp.serverUrl) {
      runners.push(this._pollOtpServer(normalizedPhone, timeout));
    }

    const hasAutomatedSource = this._isMiMSMSConfigured() || config.otp.serverUrl;
    const allowManual =
      process.env.OTP_ALLOW_MANUAL === 'true' || config.app.env !== 'production';

    if (!hasAutomatedSource && !allowManual && config.app.env === 'production') {
      logger.warn(
        `No MiMSMS or OTP server configured — relying on POST /api/otp/webhook for ${normalizedPhone}`
      );
    } else if (!hasAutomatedSource && allowManual) {
      logger.warn(
        `⚠️  Manual OTP available for ${normalizedPhone}. Enter via POST /api/otp/manual`
      );
    }

    if (runners.length === 0) {
      throw new Error(
        `No OTP source configured for phone: ${phone}. Set MIMSMS_* credentials or OTP_SERVER_URL.`
      );
    }

    try {
      return await this._raceOtpSources(runners, normalizedPhone);
    } catch (err) {
      throw new Error(
        `OTP timeout after ${timeout}ms for phone: ${phone}${err?.message ? ` (${err.message})` : ''}`
      );
    }
  }

  async _raceOtpSources(promises, phone) {
    return new Promise((resolve, reject) => {
      let remaining = promises.length;
      let settled = false;

      const onSuccess = (otp) => {
        if (settled) return;
        settled = true;
        this._cancelPending(phone);
        resolve(otp);
      };

      const onFailure = (err) => {
        remaining -= 1;
        if (remaining === 0 && !settled) {
          reject(err || new Error('All OTP sources exhausted'));
        }
      };

      for (const p of promises) {
        Promise.resolve(p).then(onSuccess, onFailure);
      }
    });
  }

  /**
   * Poll MiMSMS getinbox for inbound SMS OTP.
   * Filters by virtual number (`to`) and message date (after pipeline wait start).
   */
  async _pollMiMSMS(phone, waitStartMs, timeout) {
    const virtualNumber = config.otp.mimsms.virtualNumber;
    const deadline = waitStartMs + timeout;
    let lastError = null;

    while (Date.now() < deadline) {
      const buffered = this._consumeBufferedOtp(phone);
      if (buffered) return buffered;

      try {
        const data = await this._fetchMiMSMSInbox();
        if (data?.status === 'error') {
          lastError = new Error(data.message || 'MiMSMS getinbox error');
          logger.warn(`MiMSMS error: ${lastError.message}`);
        } else if (data?.status === 'success') {
          const otp = this._findOtpInInbox(data.inbox, phone, waitStartMs, virtualNumber);
          if (otp) {
            logger.info(`OTP via MiMSMS for ${phone}`);
            return otp;
          }
        }
      } catch (e) {
        lastError = e;
        logger.debug(`MiMSMS poll error: ${e.message}`);
      }

      const elapsed = Date.now() - waitStartMs;
      const delay = this._getMiMSMSPollDelayMs(elapsed);
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
    }

    throw lastError || new Error('MiMSMS OTP timeout');
  }

  async _fetchMiMSMSInbox() {
    const { apiKey, apiToken, baseUrl, inboxList } = config.otp.mimsms;
    const res = await axios.get(baseUrl, {
      params: {
        getinbox: 'getinbox',
        apikey: apiKey,
        apitoken: apiToken,
        list: inboxList || 'unread',
      },
      timeout: 10_000,
    });
    return res.data;
  }

  _getMiMSMSPollDelayMs(elapsedMs) {
    const base = config.otp.mimsms.pollInterval || 3000;
    if (elapsedMs < 60_000) return base;
    if (elapsedMs < 120_000) return 5000;
    return 10_000;
  }

  _findOtpInInbox(inbox, phone, waitStartMs, virtualNumber) {
    const virtualDigits = this._normalizeDigits(virtualNumber);
    const candidates = [];

    for (const msg of inbox || []) {
      const id = msg?.id != null ? String(msg.id) : '';
      if (id && this.processedMessageIds.has(id)) continue;

      const toDigits = this._normalizeDigits(msg.to);
      if (virtualDigits && toDigits !== virtualDigits) continue;

      const msgDate = this._parseMiMSMSDate(msg.date);
      if (msgDate && msgDate.getTime() < waitStartMs - 2000) continue;

      const otp = this._extractOtp(msg.message);
      if (!otp) continue;

      candidates.push({ id, otp, date: msgDate });
    }

    candidates.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

    for (const candidate of candidates) {
      if (candidate.id) this.processedMessageIds.add(candidate.id);
      return candidate.otp;
    }

    return null;
  }

  _parseMiMSMSDate(dateStr) {
    if (!dateStr) return null;
    const normalized = String(dateStr).trim().replace(' ', 'T');
    const parsed = new Date(`${normalized}+06:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Poll self-hosted OTP server (diptosaya/otp-server format).
   */
  async _pollOtpServer(phone, timeout) {
    const startTime = Date.now();
    const pollInterval = config.otp.pollInterval || 3000;

    try {
      await axios.post(`${config.otp.serverUrl}/api/register`, {
        phone,
        apiKey: config.otp.apiKey,
      });
    } catch (e) {
      logger.warn('OTP server registration failed, proceeding with poll only');
    }

    while (Date.now() - startTime < timeout) {
      const buffered = this._consumeBufferedOtp(phone);
      if (buffered) return buffered;

      try {
        const res = await axios.get(`${config.otp.serverUrl}/api/otp/${phone}`, {
          headers: { 'x-api-key': config.otp.apiKey },
          timeout: 5000,
        });

        if (res.data?.otp) {
          const otp = String(res.data.otp).trim();
          logger.info(`OTP received from OTP server for ${phone}`);

          await axios
            .delete(`${config.otp.serverUrl}/api/otp/${phone}`, {
              headers: { 'x-api-key': config.otp.apiKey },
            })
            .catch(() => {});

          return otp;
        }
      } catch (e) {
        if (e.response?.status !== 404) {
          logger.debug(`OTP server poll error: ${e.message}`);
        }
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error('OTP server timeout');
  }

  /**
   * Wait for webhook or manual admin OTP via submitManualOtp().
   */
  async _waitForPendingDelivery(phone, timeout) {
    const buffered = this._consumeBufferedOtp(phone);
    if (buffered) return buffered;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(phone);
        reject(new Error('Webhook OTP timeout'));
      }, timeout);

      this.pending.set(phone, { resolve, reject, timer });
    });
  }

  /**
   * Submit manual or webhook OTP (called from API endpoints).
   */
  submitManualOtp(phone, otp) {
    const normalizedPhone = this._normalizePhone(phone);
    const pending = this.pending.get(normalizedPhone);

    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(normalizedPhone);
      pending.resolve(String(otp).trim());
      return true;
    }

    this._pruneBuffer();
    this.buffer.set(normalizedPhone, {
      otp: String(otp).trim(),
      expiresAt: Date.now() + this.bufferTtlMs,
    });
    return false;
  }

  /**
   * Extract 6-digit OTP from SMS text.
   */
  _extractOtp(text) {
    if (!text) return null;
    const patterns = [
      /\b(\d{6})\b.*(?:OTP|code|pin|verification)/i,
      /(?:OTP|code|pin|verification).*\b(\d{6})\b/i,
      /\b(\d{6})\b/,
    ];
    for (const p of patterns) {
      const match = text.match(p);
      if (match) return match[1];
    }
    return null;
  }

  _normalizePhone(phone) {
    return phone.replace(/\D/g, '').replace(/^88/, '');
  }

  _normalizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }
}

module.exports = new OtpHandler();
