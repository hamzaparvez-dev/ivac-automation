// src/modules/registration.js
// Handles new IVAC account registration with OTP verification
const browserManager = require('./browser');
const otpHandler = require('./otpHandler');
const captchaSolver = require('./captchaSolver');
const config = require('../config/config');
const logger = require('../services/logger');
const PO = require('../ivac/pageObjects');
const { v4: uuidv4 } = require('uuid');

const delay = (min, max) =>
  new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

class RegistrationModule {
  async register(applicantData, phone, password, email, photoPath) {
    const sessionId = `reg_${uuidv4()}`;
    const log = logger.forApp(sessionId);
    let browserInstance;

    try {
      log.info(`Starting registration for: ${applicantData.fullName}`);
      browserInstance = await browserManager.launch(sessionId, { blockMedia: false });
      const { page } = browserInstance;

      await page.goto(`${config.ivac.baseUrl}/for-bangladeshi`, {
        waitUntil: 'domcontentloaded',
      });

      await delay(1000, 2000);
      await captchaSolver.ensureResolved(page, 'register_landing', log);

      await this._clickRegisterButton(page, log, sessionId);
      await captchaSolver.ensureResolved(page, 'register_form', log);

      await this._fillRegistrationForm(page, {
        ...applicantData,
        phone,
        password,
        email,
      }, log, sessionId);

      if (photoPath) {
        await this._uploadPhoto(page, photoPath, log);
      }

      await this._submitForm(page, log);

      const otp = await otpHandler.waitForOtp(phone);
      await this._enterOtp(page, otp, log);

      await this._completeRegistration(page, log);

      const cookies = await page.context().cookies();
      const storageState = await page.context().storageState();

      log.info('Registration completed successfully');

      return {
        success: true,
        phone,
        email,
        cookies,
        storageState,
        sessionId,
      };
    } catch (error) {
      log.error(`Registration failed: ${error.message}`);
      if (browserInstance) {
        await browserManager.saveFailureArtifacts(sessionId, 'registration');
      }
      throw error;
    } finally {
      await browserManager.close(sessionId);
    }
  }

  async _clickRegisterButton(page, log, sessionId) {
    log.debug('Looking for register/apply button...');
    const ok = await PO.clickFirstMatch(page, PO.register.entry, log, 'register_entry');
    if (ok) {
      await page.waitForLoadState('domcontentloaded');
      return;
    }
    await PO.selectorMissScreenshot(page, sessionId, 'register_entry');
    await page.goto(`${config.ivac.baseUrl}/register`, { waitUntil: 'domcontentloaded' });
  }

  async _fillRegistrationForm(page, data, log, sessionId) {
    log.debug('Filling registration form...');
    await delay(500, 1000);

    const fields = [
      ['passportNumber', PO.register.passport],
      ['surname', PO.register.surname],
      ['givenName', PO.register.givenName],
      ['dateOfBirth', PO.register.dob],
      ['phone', PO.register.phone],
      ['email', PO.register.email],
      ['password', PO.register.password],
      ['password', PO.register.confirmPassword],
    ];

    for (const [key, selectors] of fields) {
      const value = key === 'password' ? data.password : data[key];
      if (!value) continue;
      const ok = await PO.fillFirstMatch(page, selectors, value, log, key);
      if (!ok) await PO.selectorMissScreenshot(page, sessionId, `reg_${key}`);
      await delay(100, 300);
    }

    await this._selectDropdown(page, PO.register.gender, data.gender);
    const nat = String(data.nationality || '').trim();
    const natLabel = nat && /^bangladeshi$/i.test(nat) ? 'Bangladesh' : (nat || 'Bangladesh');
    await this._selectDropdown(page, PO.register.nationality, natLabel);
  }

  async _uploadPhoto(page, photoPath, log) {
    log.debug('Uploading applicant photo...');
    for (const sel of PO.register.photoFile) {
      const input = await page.$(sel);
      if (input) {
        await input.setInputFiles(photoPath);
        await delay(1000, 2000);
        log.debug('Photo uploaded');
        return;
      }
    }
    log.warn('Photo upload input not found');
  }

  async _submitForm(page, log) {
    log.debug('Submitting registration form...');
    await delay(500, 1000);
    const ok = await PO.clickFirstMatch(page, PO.register.submit, log, 'register_submit');
    if (!ok) throw new Error('Submit button not found');
    await delay(2000, 3000);
  }

  async _enterOtp(page, otp, log) {
    log.info('Entering registration OTP');
    await delay(500, 1000);
    for (const sel of PO.register.otp) {
      const el = await page.$(sel);
      if (el) {
        await el.fill(otp);
        await delay(500, 1000);
        await PO.clickFirstMatch(page, PO.register.otpVerify, log, 'reg_otp_verify');
        await delay(2000, 3000);
        return;
      }
    }
    throw new Error('OTP input not found');
  }

  async _completeRegistration(page, log) {
    log.debug('Completing registration...');
    await page.waitForLoadState('domcontentloaded');
    await delay(1000, 2000);

    const bodyText = await page.textContent('body').catch(() => '');
    if (/already\s+registered/i.test(bodyText) || /already\s+exist/i.test(bodyText)) {
      throw new Error('already registered');
    }

    for (const sel of PO.register.success) {
      const el = await page.$(sel);
      if (el) {
        log.info('Registration success message found');
        return;
      }
    }
    throw new Error('Registration success not confirmed');
  }

  async _selectDropdown(page, selectors, value) {
    if (!value) return;
    const list = Array.isArray(selectors)
      ? selectors
      : selectors.split(',').map((s) => s.trim());
    for (const sel of list) {
      const el = await page.$(sel);
      if (el) {
        await page
          .selectOption(sel, { label: value })
          .catch(async () => {
            await page.selectOption(sel, { value: value.toLowerCase() }).catch(() => {});
          });
        return;
      }
    }
  }
}

module.exports = new RegistrationModule();
