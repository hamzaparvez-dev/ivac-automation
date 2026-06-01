// src/modules/payment.js
// Handles IVAC visa processing fee payment
// IVAC uses SSLCommerz as their payment gateway
const config = require('../config/config');
const logger = require('../services/logger');
const captchaSolver = require('./captchaSolver');
const PO = require('../ivac/pageObjects');

const delay = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

class PaymentModule {
  /**
   * Initiate and complete payment for visa processing fee
   * @param {object} page - Active Playwright page (logged in, after slot booking)
   * @param {object} application - Application details
   * @param {string} paymentMode - 'self' | 'manual'
   * @param {string} sessionId
   */
  async processPayment(page, application, paymentMode = 'self', sessionId) {
    const log = logger.forApp(sessionId);
    log.info(`Processing payment (mode: ${paymentMode}) for: ${application.applicantName}`);

    // Navigate to payment section
    await this._navigateToPayment(page, log);
    await captchaSolver.ensureResolved(page, 'payment', log);

    // Verify amount
    const amount = await this._getPaymentAmount(page, log);
    log.info(`Payment amount: BDT ${amount}`);

    if (paymentMode === 'self') {
      // Self-pay: redirect to SSLCommerz, applicant pays manually
      return this._initiateSSLCommerzPayment(page, application, amount, log);
    } else {
      // Manual: just navigate to payment page and wait
      return { success: false, reason: 'MANUAL_PAYMENT_REQUIRED', amount };
    }
  }

  async _navigateToPayment(page, log) {
    log.debug('Navigating to payment...');
    const ok = await PO.clickFirstMatch(page, PO.payment.nav, log, 'payment_nav');
    if (ok) {
      await page.waitForLoadState('domcontentloaded');
      await delay(1000, 2000);
      return;
    }
    log.warn('Payment navigation not found, assuming already on payment page');
  }

  async _getPaymentAmount(page, log) {
    for (const sel of PO.payment.amount) {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        const amount = text?.match(/[\d,]+/)?.[0]?.replace(/,/g, '');
        if (amount) return parseInt(amount, 10);
      }
    }
    return 1500;
  }

  async _initiateSSLCommerzPayment(page, application, amount, log) {
    log.info('Initiating SSLCommerz payment...');

    // Click "Pay" button to go to SSLCommerz
    let payBtn = null;
    for (const sel of PO.payment.payNow) {
      payBtn = await page.$(sel);
      if (payBtn) break;
    }
    if (payBtn) {
      await payBtn.click();
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
    }

    // Check if redirected to SSLCommerz
    const currentUrl = page.url();
    const isSSLCommerz = currentUrl.includes('sslcommerz') || currentUrl.includes('securepay');
    log.info(`Redirected to: ${currentUrl}`);

    if (isSSLCommerz) {
      // WAF/captcha can appear on the gateway page itself; check again after redirect.
      await delay(500, 1200);
      await captchaSolver.ensureResolved(page, 'sslcommerz_gateway', log);

      log.info('On SSLCommerz payment gateway - applicant must complete payment manually');
      return {
        success: false,
        reason: 'REDIRECTED_TO_GATEWAY',
        paymentUrl: currentUrl,
        amount,
        message: 'Please complete payment on SSLCommerz',
      };
    }

    return { success: false, reason: 'PAYMENT_GATEWAY_NOT_REACHED', amount };
  }

  async _processAutoPayment(page, application, amount, log) {
    log.info('Processing automatic payment...');

    // Navigate to bKash or card payment
    let bkashBtn = null;
    for (const sel of PO.payment.bkash) {
      bkashBtn = await page.$(sel);
      if (bkashBtn) break;
    }
    if (bkashBtn) {
      return this._processBkashPayment(page, application, log);
    }

    let cardBtn = null;
    for (const sel of PO.payment.card) {
      cardBtn = await page.$(sel);
      if (cardBtn) break;
    }
    if (cardBtn) {
      return this._processCardPayment(page, application, log);
    }

    log.warn('Auto-payment method not found');
    return { success: false, reason: 'PAYMENT_METHOD_NOT_AVAILABLE' };
  }

  async _processBkashPayment(page, application, log) {
    log.info('Processing bKash payment...');
    // bKash requires phone OTP - handled via OTP server
    const otpHandler = require('./otpHandler');

    const bkashPhone = process.env.BKASH_PHONE;
    const bkashPin = process.env.BKASH_PIN;

    if (!bkashPhone || !bkashPin) {
      return { success: false, reason: 'BKASH_CREDENTIALS_NOT_SET' };
    }

    await page.$eval('[data-method="bkash"]', el => el.click()).catch(() => {});
    await delay(2000, 3000);

    await page.fill('input[name*="bkash_number"], #bkashNumber', bkashPhone);
    await delay(500, 1000);
    await page.click('button:has-text("Next"), button:has-text("Send OTP")');

    const otp = await otpHandler.waitForOtp(bkashPhone, 60000);
    await page.fill('input[name*="otp"]', otp);
    await delay(500, 1000);
    await page.fill('input[name*="pin"], input[type="password"]', bkashPin);
    await delay(500, 1000);
    await page.click('button:has-text("Confirm"), button:has-text("Pay")');
    await delay(5000, 8000);

    const success = await this._verifyPaymentSuccess(page, log);
    return { success, reason: success ? null : 'BKASH_PAYMENT_FAILED' };
  }

  async _processCardPayment(page, application, log) {
    log.info('Processing card payment...');
    const cardNumber = process.env.CARD_NUMBER;
    const cardExpiry = process.env.CARD_EXPIRY;
    const cardCVV = process.env.CARD_CVV;
    const cardName = process.env.CARD_NAME;

    if (!cardNumber) {
      return { success: false, reason: 'CARD_CREDENTIALS_NOT_SET' };
    }

    await page.fill('input[name*="card_number"], #cardNumber', cardNumber);
    await page.fill('input[name*="expiry"], #expiry', cardExpiry);
    await page.fill('input[name*="cvv"], #cvv', cardCVV);
    await page.fill('input[name*="name"], #cardName', cardName);
    await delay(500, 1000);
    await page.click('button:has-text("Pay"), button[type="submit"]');
    await delay(5000, 8000);

    const success = await this._verifyPaymentSuccess(page, log);
    return { success, reason: success ? null : 'CARD_PAYMENT_FAILED' };
  }

  async _verifyPaymentSuccess(page, log) {
    await page.waitForLoadState('domcontentloaded');
    const text = await page.textContent('body').catch(() => '');
    if (text.includes('success') || text.includes('paid') || text.includes('confirmed')) {
      log.info('Payment success detected');
      return true;
    }
    for (const sel of PO.payment.success) {
      if (await page.$(sel)) return true;
    }
    return false;
  }
}

module.exports = new PaymentModule();
