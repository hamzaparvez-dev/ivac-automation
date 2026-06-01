// src/modules/login.js
// Handles IVAC account login and session management
const browserManager = require('./browser');
const otpHandler = require('./otpHandler');
const captchaSolver = require('./captchaSolver');
const config = require('../config/config');
const logger = require('../services/logger');
const PO = require('../ivac/pageObjects');
const { v4: uuidv4 } = require('uuid');

const delay = (min, max) =>
  new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

class LoginModule {
  async login(phone, password, options = {}) {
    const sessionId = options.sessionId || `login_${uuidv4()}`;
    const log = logger.forApp(sessionId);

    log.info(`Logging in: ${phone}`);

    let browserInstance;
    try {
      browserInstance = await browserManager.launch(sessionId, {
        blockMedia: options.blockMedia,
        timeoutMs: options.timeoutMs,
        timeoutMultiplier: options.timeoutMultiplier,
      });
      const { page } = browserInstance;

      await page.goto(config.ivac.loginUrl, { waitUntil: 'domcontentloaded' });
      await delay(1000, 2000);

      await captchaSolver.ensureResolved(page, 'login', log);

      await this._fillCredentials(page, phone, password, log, sessionId);
      await this._submitLogin(page, log);

      const needsOtp = await this._checkForOtpField(page);
      if (needsOtp) {
        log.info('OTP required for login');
        const otp = await otpHandler.waitForOtp(phone);
        await this._enterOtp(page, otp, log);
      }

      await this._verifyLoginSuccess(page, log);

      const cookies = await page.context().cookies();
      const storageState = await page.context().storageState();

      log.info('Login successful');
      return {
        success: true,
        page,
        context: page.context(),
        browserInstance,
        sessionId,
        cookies,
        storageState,
      };
    } catch (error) {
      log.error(`Login failed: ${error.message}`);
      if (browserInstance) {
        await browserManager.saveFailureArtifacts(sessionId, 'login');
        await browserManager.close(sessionId);
      }
      throw error;
    }
  }

  async loginWithSession(storageState, options = {}) {
    const sessionId = options.sessionId || `session_${uuidv4()}`;
    const log = logger.forApp(sessionId);

    const browserInstance = await browserManager.launchWithStorageState(
      sessionId,
      storageState,
      { blockMedia: options.blockMedia }
    );
    const { page } = browserInstance;

    try {
      await page.goto(config.ivac.baseUrl, { waitUntil: 'domcontentloaded' });
      const isValid = await this._isSessionValid(page);
      if (!isValid) {
        await browserManager.saveFailureArtifacts(sessionId, 'session_invalid');
        await browserManager.close(sessionId);
        throw new Error('Saved session expired');
      }

      return {
        page,
        context: page.context(),
        browser: browserInstance.browser,
        browserInstance,
        sessionId,
      };
    } catch (e) {
      await browserManager.saveFailureArtifacts(sessionId, 'session_err');
      await browserManager.close(sessionId);
      throw e;
    }
  }

  async _fillCredentials(page, phone, password, log, sessionId) {
    log.debug('Filling login credentials...');
    const okPhone = await PO.fillFirstMatch(page, PO.login.phone, phone, log, 'login_phone');
    if (!okPhone) await PO.selectorMissScreenshot(page, sessionId, 'login_phone');
    await delay(300, 600);
    const okPass = await PO.fillFirstMatch(page, PO.login.password, password, log, 'login_password');
    if (!okPass) await PO.selectorMissScreenshot(page, sessionId, 'login_password');
  }

  async _submitLogin(page, log) {
    log.debug('Submitting login...');
    const ok = await PO.clickFirstMatch(page, PO.login.submit, log, 'login_submit');
    if (!ok) throw new Error('Login submit button not found');
    await delay(2000, 3000);
  }

  async _checkForOtpField(page) {
    await delay(1000, 2000);
    for (const sel of PO.login.otp) {
      const el = await page.$(sel);
      if (el) return true;
    }
    return false;
  }

  async _enterOtp(page, otp, log) {
    log.info('Entering login OTP');
    for (const sel of PO.login.otp) {
      const el = await page.$(sel);
      if (el) {
        await el.fill(otp);
        await delay(500, 1000);
        const ok = await PO.clickFirstMatch(page, PO.login.otpVerify, log, 'otp_verify');
        if (!ok) throw new Error('OTP verify button not found');
        await delay(2000, 3000);
        return;
      }
    }
    throw new Error('OTP input not found');
  }

  async _verifyLoginSuccess(page, log) {
    log.debug('Verifying login...');
    await page.waitForLoadState('domcontentloaded');

    for (const sel of PO.login.success) {
      const el = await page.$(sel);
      if (el) {
        log.debug('Login verified via UI indicator');
        return true;
      }
    }

    const currentUrl = page.url();
    if (!currentUrl.includes('login') && !currentUrl.includes('signin')) {
      return true;
    }

    throw new Error('Login verification failed - still on login page');
  }

  async _isSessionValid(page) {
    const url = page.url();
    return !url.includes('login') && !url.includes('signin');
  }
}

module.exports = new LoginModule();
