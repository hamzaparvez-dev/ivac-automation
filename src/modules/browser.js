// src/modules/browser.js
// Playwright-extra + stealth; single launch path for IVAC automation
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const config = require('../config/config');
const logger = require('../services/logger');

const logsDir = path.join(__dirname, '../../logs');

class BrowserManager {
  constructor() {
    this.activeBrowsers = new Map();
    this.maxConcurrent = config.browser.maxConcurrent;
  }

  _randomUserAgent() {
    const agents = config.browser.userAgents;
    return agents[Math.floor(Math.random() * agents.length)];
  }

  /**
   * Parse PROXY_LIST entries for Playwright: never pass credentials inside `server`
   * (residential proxies need explicit username/password fields).
   */
  _parsePlaywrightProxy(proxyString) {
    if (!proxyString) return undefined;
    try {
      const url = new URL(proxyString);
      const hostPort = url.port
        ? `${url.hostname}:${url.port}`
        : url.hostname;
      const proxyConfig = {
        server: `${url.protocol}//${hostPort}`,
      };
      if (url.username && url.password) {
        proxyConfig.username = decodeURIComponent(url.username);
        proxyConfig.password = decodeURIComponent(url.password);
      }
      return proxyConfig;
    } catch (e) {
      logger.error(`Invalid proxy URL: ${proxyString} — ${e.message}`);
      return undefined;
    }
  }

  _launchOptions(proxyString, options) {
    const proxyConfig = this._parsePlaywrightProxy(proxyString);
    return {
      headless: options.headless ?? config.browser.headless,
      slowMo: options.slowMo ?? config.browser.slowMo,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--lang=en-US,en',
      ],
      ...(proxyConfig ? { proxy: proxyConfig } : {}),
    };
  }

  async _newContext(browser, ua, storageState = null) {
    const ctxOpts = {
      userAgent: ua,
      // Matches desktop-only user agents in config (mobile UA + this viewport = WAF red flag)
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: config.ivac.timezone || 'Asia/Dhaka',
      geolocation: { longitude: 90.4125, latitude: 23.8103 },
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    };
    if (storageState) ctxOpts.storageState = storageState;
    return browser.newContext(ctxOpts);
  }

  /**
   * @param {string} sessionId
   * @param {object} options - { blockMedia?, headless?, storageState? }
   */
  async launch(sessionId, options = {}) {
    if (this.activeBrowsers.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent browsers (${this.maxConcurrent}) reached`);
    }

    const ua = this._randomUserAgent();
    const proxyList = Array.isArray(config.browser.proxyList) ? config.browser.proxyList : [];
    const proxy = proxyList.length > 0
      ? proxyList[Math.floor(Math.random() * proxyList.length)]
      : null;

    const browser = await chromium.launch(this._launchOptions(proxy, options));

    const context = await this._newContext(browser, ua, options.storageState || null);

    if (config.browser.traceOnFailure) {
      await context.tracing.start({ screenshots: true, snapshots: true });
    }

    const page = await context.newPage();
    const baseTimeout = config.browser.timeout;
    const timeoutMs = options.timeoutMs
      ?? (options.timeoutMultiplier ? Math.round(baseTimeout * options.timeoutMultiplier) : null)
      ?? baseTimeout;
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    const blockMedia = options.blockMedia !== undefined
      ? options.blockMedia
      : config.browser.blockMedia;

    if (blockMedia) {
      await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,otf}', (route) =>
        route.abort());
    }

    await page.route('**/{google-analytics,analytics,gtag,facebook,hotjar}**', (route) =>
      route.abort());

    const instance = {
      browser,
      context,
      page,
      sessionId,
      createdAt: Date.now(),
      _tracingOn: config.browser.traceOnFailure,
      timeoutMs,
    };
    this.activeBrowsers.set(sessionId, instance);
    logger.debug(`Browser launched: ${sessionId} stealth blockMedia=${!!blockMedia}`);
    return instance;
  }

  /**
   * Resume IVAC session from Playwright storageState JSON (same stealth launch path).
   */
  async launchWithStorageState(sessionId, storageState, options = {}) {
    return this.launch(sessionId, { ...options, storageState });
  }

  async saveFailureArtifacts(sessionId, tag = 'error') {
    const inst = this.activeBrowsers.get(sessionId);
    if (!inst) return;
    const safeTag = String(tag).replace(/[^a-z0-9_-]/gi, '_');
    try {
      if (config.browser.debugPw && inst.page) {
        await inst.page.screenshot({
          path: path.join(logsDir, `debug_${sessionId}_${safeTag}.png`),
          fullPage: true,
        });
      }
      if (inst._tracingOn && inst.context) {
        await inst.context.tracing.stop({
          path: path.join(logsDir, `trace_${sessionId}_${safeTag}.zip`),
        });
        inst._tracingOn = false;
      }
    } catch (e) {
      logger.warn(`saveFailureArtifacts: ${e.message}`);
    }
  }

  async close(sessionId) {
    const instance = this.activeBrowsers.get(sessionId);
    if (!instance) return;
    try {
      if (instance._tracingOn && instance.context) {
        await instance.context.tracing.stop().catch(() => {});
        instance._tracingOn = false;
      }
    } catch (e) {
      /* ignore */
    }
    try {
      await instance.browser.close();
    } catch (e) {
      /* ignore */
    }
    this.activeBrowsers.delete(sessionId);
    logger.debug(`Browser closed: ${sessionId}`);
  }

  async closeAll() {
    for (const sessionId of [...this.activeBrowsers.keys()]) {
      await this.close(sessionId);
    }
  }

  static async humanDelay(min = 500, max = 1500) {
    const delay = Math.floor(Math.random() * (max - min) + min);
    await new Promise((r) => setTimeout(r, delay));
  }

  static async humanType(page, selector, text) {
    await page.click(selector);
    await BrowserManager.humanDelay(200, 500);
    await page.fill(selector, '');
    for (const char of text) {
      await page.type(selector, char, {
        delay: Math.floor(Math.random() * 80 + 40),
      });
    }
  }

  static async waitForElement(page, selector, timeout = 10000) {
    try {
      await page.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  static async safeClick(page, selector) {
    await page.waitForSelector(selector, { state: 'visible' });
    await page.evaluate((sel) => {
      document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, selector);
    await BrowserManager.humanDelay(300, 600);
    await page.click(selector);
  }

  get activeCount() {
    return this.activeBrowsers.size;
  }
}

module.exports = new BrowserManager();
