// src/modules/captchaSolver.js
// 2Captcha for reCAPTCHA v2 when IVAC shows it
const axios = require('axios');
const config = require('../config/config');
const logger = require('../services/logger');
const PO = require('../ivac/pageObjects');

const TWOCAPTCHA_IN = 'https://2captcha.com/in.php';
const TWOCAPTCHA_RES = 'https://2captcha.com/res.php';
const POLL_MS = 5000;
const MAX_WAIT_MS = 120000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function twoCaptchaSolveRecaptcha(siteKey, pageUrl) {
  const apiKey = config.captcha.twoCaptchaKey;
  if (!apiKey) throw new Error('TWOCAPTCHA_API_KEY not configured');

  const params = new URLSearchParams({
    key: apiKey,
    method: 'userrecaptcha',
    googlekey: siteKey,
    pageurl: pageUrl,
    json: '1',
  });

  const submit = await axios.post(TWOCAPTCHA_IN, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000,
  });

  if (submit.data.status !== 1) {
    throw new Error(submit.data.request || '2captcha submit failed');
  }

  const taskId = submit.data.request;
  const started = Date.now();

  while (Date.now() - started < MAX_WAIT_MS) {
    const res = await axios.get(TWOCAPTCHA_RES, {
      params: { key: apiKey, action: 'get', id: taskId, json: 1 },
      timeout: 30000,
    });

    if (res.data.status === 1) {
      return String(res.data.request).trim();
    }
    if (res.data.request === 'CAPCHA_NOT_READY') {
      await sleep(POLL_MS);
      continue;
    }
    throw new Error(res.data.request || '2captcha poll failed');
  }

  throw new Error('2captcha solve timeout');
}

async function antiCaptchaSolveRecaptcha(siteKey, pageUrl) {
  const apiKey = config.captcha.antiCaptchaKey;
  if (!apiKey) throw new Error('ANTICAPTCHA_API_KEY not configured');

  const create = await axios.post(
    'https://api.anti-captcha.com/createTask',
    {
      clientKey: apiKey,
      task: {
        type: 'RecaptchaV2TaskProxyless',
        websiteURL: pageUrl,
        websiteKey: siteKey,
      },
    },
    { timeout: 30000 }
  );

  if (create.data?.errorId) {
    throw new Error(create.data?.errorDescription || 'anticaptcha createTask failed');
  }
  const taskId = create.data?.taskId;
  if (!taskId) throw new Error('anticaptcha createTask did not return taskId');

  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const res = await axios.post(
      'https://api.anti-captcha.com/getTaskResult',
      { clientKey: apiKey, taskId },
      { timeout: 30000 }
    );

    if (res.data?.errorId) {
      throw new Error(res.data?.errorDescription || 'anticaptcha getTaskResult failed');
    }
    if (res.data?.status === 'processing') {
      await sleep(POLL_MS);
      continue;
    }
    if (res.data?.status === 'ready') {
      const token = res.data?.solution?.gRecaptchaResponse;
      if (!token) throw new Error('anticaptcha ready but missing gRecaptchaResponse');
      return String(token).trim();
    }
    await sleep(POLL_MS);
  }

  throw new Error('anticaptcha solve timeout');
}

async function extractSiteKey(page) {
  for (const sel of PO.captcha.sitekey) {
    const el = await page.$(sel);
    if (el) {
      const sk = await el.getAttribute('data-sitekey').catch(() => null);
      if (sk) return sk;
    }
  }
  const any = await page.$('[data-sitekey]');
  if (any) {
    const sk = await any.getAttribute('data-sitekey');
    if (sk) return sk;
  }
  return null;
}

async function visibleChallengePresent(page) {
  if (await extractSiteKey(page)) return true;
  for (const sel of PO.captcha.iframe) {
    if (await page.$(sel)) return true;
  }
  return false;
}

async function injectRecaptchaToken(page, token) {
  await page.evaluate((t) => {
    document
      .querySelectorAll('textarea[name="g-recaptcha-response"], textarea.g-recaptcha-response')
      .forEach((a) => {
        a.value = t;
        a.innerHTML = t;
        a.dispatchEvent(new Event('input', { bubbles: true }));
      });
    try {
      const clients = window.___grecaptcha_cfg?.clients;
      if (clients && typeof clients === 'object') {
        Object.keys(clients).forEach((k) => {
          const client = clients[k];
          if (client && typeof client === 'object') {
            Object.keys(client).forEach((id) => {
              const c = client[id];
              if (c?.callback && typeof c.callback === 'function') {
                try {
                  c.callback(t);
                } catch (e) {
                  /* ignore */
                }
              }
            });
          }
        });
      }
    } catch (e) {
      /* ignore */
    }
  }, token);
}

async function ensureResolved(page, stepLabel, log = logger) {
  const present = await visibleChallengePresent(page);
  if (!present) return { solved: false, skipped: true };

  const service = String(config.captcha.service || '2captcha').toLowerCase();
  const using2c = service.includes('2captcha');
  const usingAnti = service.includes('anticaptcha');

  if (using2c && !config.captcha.twoCaptchaKey) {
    const msg = `reCAPTCHA visible at "${stepLabel}" but TWOCAPTCHA_API_KEY is not set`;
    if (config.app.env === 'production') {
      log.error(msg);
      throw new Error(msg);
    }
    log.warn(`${msg} (non-production: continuing)`);
    return { solved: false, skipped: false, error: msg };
  }

  if (usingAnti && !config.captcha.antiCaptchaKey) {
    const msg = `reCAPTCHA visible at "${stepLabel}" but ANTICAPTCHA_API_KEY is not set`;
    if (config.app.env === 'production') {
      log.error(msg);
      throw new Error(msg);
    }
    log.warn(`${msg} (non-production: continuing)`);
    return { solved: false, skipped: false, error: msg };
  }

  const siteKey = await extractSiteKey(page);
  if (!siteKey) {
    log.warn(`Captcha iframe present but no data-sitekey at ${stepLabel}`);
    return { solved: false, skipped: false };
  }

  const pageUrl = page.url();
  let token;
  if (usingAnti) {
    log.info(`Solving reCAPTCHA v2 via anticaptcha (${stepLabel})...`);
    token = await antiCaptchaSolveRecaptcha(siteKey, pageUrl);
  } else {
    log.info(`Solving reCAPTCHA v2 via 2captcha (${stepLabel})...`);
    token = await twoCaptchaSolveRecaptcha(siteKey, pageUrl);
  }
  await injectRecaptchaToken(page, token);
  log.info('reCAPTCHA token injected');
  return { solved: true };
}

module.exports = {
  ensureResolved,
  visibleChallengePresent,
  extractSiteKey,
  twoCaptchaSolveRecaptcha,
  antiCaptchaSolveRecaptcha,
  injectRecaptchaToken,
};
