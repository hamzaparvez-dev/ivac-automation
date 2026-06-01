// src/modules/slotBooker.js
// ⚡ HIGH-PRIORITY: The core competitive module for grabbing IVAC appointment slots
// Uses aggressive polling, session pre-warming, and concurrent slot checking
const config = require('../config/config');
const logger = require('../services/logger');
const notifier = require('../services/notifier');
const captchaSolver = require('./captchaSolver');
const PO = require('../ivac/pageObjects');
const { EventEmitter } = require('events');

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (min, max) => Math.floor(Math.random() * (max - min) + min);

class SlotBooker extends EventEmitter {
  constructor() {
    super();
    this.activeMonitors = new Map(); // applicationId -> monitor state
    this.slotCheckInterval = config.ivac.slotCheckInterval;
  }

  /**
   * Main entry: Book a slot for given application
   * @param {object} page - Active logged-in Playwright page
   * @param {object} application - Application details
   * @param {string} sessionId
   */
  async bookSlot(page, application, sessionId) {
    const log = logger.forApp(sessionId);
    log.info(`Attempting slot booking: ${application.visaType} @ ${application.ivacLocation}`);

    // Navigate to slot booking section
    await this._navigateToSlotBooking(page, log);
    await captchaSolver.ensureResolved(page, 'slots', log);

    // Select location and visa type
    await this._selectBookingOptions(page, application, log);

    // Check slot availability
    const slotFound = await this._findAndSelectSlot(page, application, log);
    if (!slotFound) {
      log.warn('No slots available at this time');
      return { success: false, reason: 'NO_SLOTS' };
    }

    // Add attendees if any
    if (application.attendees?.length > 0) {
      await this._addAttendees(page, application.attendees, log);
    }

    // Confirm booking
    await this._confirmBooking(page, log);

    // Get appointment details
    const appointment = await this._getAppointmentDetails(page, log);

    log.info(`✅ Slot booked! Date: ${appointment.date}, Time: ${appointment.time}, Token: ${appointment.token}`);
    this.emit('slotBooked', { sessionId, appointment, application });
    await notifier.slotBooked(application, appointment);

    return { success: true, appointment };
  }

  /**
   * Monitor mode: Continuously poll for slots until one is found
   * This is the COMPETITIVE mode - hammers the server right when slots open
   * @param {object} loginCredentials - { phone, password }
   * @param {object} application - Application details
   * @param {object} options - { preferredDates, maxAttempts, startAt5PM }
   */
  async monitorAndBook(loginCredentials, application, options = {}) {
    const { applicationId } = application;
    const log = logger.forApp(applicationId);

    if (this.activeMonitors.has(applicationId)) {
      throw new Error(`Monitor already running for ${applicationId}`);
    }

    const state = {
      running: true,
      attempts: 0,
      maxAttempts: options.maxAttempts || Infinity,
      startAt5PM: options.startAt5PM !== false, // Default: wait for 5PM
    };
    this.activeMonitors.set(applicationId, state);

    log.info(`🎯 Monitor started for ${application.visaType} @ ${application.ivacLocation}`);

    try {
      // Strategy 1: If it's before 5PM, wait until 5PM - 30s (pre-warm)
      if (state.startAt5PM) {
        await this._waitUntilSlotTime(log);
      }

      // Strategy 2: Rapid-fire polling loop
      while (state.running && state.attempts < state.maxAttempts) {
        state.attempts++;
        log.debug(`Slot check attempt #${state.attempts}`);

        try {
          // Login fresh each attempt (avoid session expiry)
          const loginModule = require('./login');
          const loginResult = await loginModule.login(
            loginCredentials.phone,
            loginCredentials.password,
            {
              sessionId: `monitor_${applicationId}_${state.attempts}`,
              blockMedia: config.browser.blockMediaSlotMonitor,
            }
          );

          const { page, browserInstance, sessionId } = loginResult;

          try {
            // Navigate and check slots
            await this._navigateToSlotBooking(page, log);
            await captchaSolver.ensureResolved(page, 'slots_monitor', log);
            await this._selectBookingOptions(page, application, log);

            const available = await this._checkSlotsAvailable(page, application, log);

            if (available.length > 0) {
              log.info(`🎉 SLOTS FOUND: ${available.length} slot(s) available!`);
              this.emit('slotsFound', { applicationId, available });

              // Try to book the best slot
              const booked = await this._selectAndConfirmSlot(page, available, application, log);

              if (booked.success) {
                state.running = false;
                this.activeMonitors.delete(applicationId);
                this.emit('slotBooked', {
                  sessionId: applicationId,
                  appointment: booked.appointment,
                  application: { applicationId },
                });
                return booked;
              }
            } else {
              log.debug('No slots found, retrying...');
            }

          } finally {
            const { browserManager } = require('./browser');
            await browserManager.close(sessionId).catch(() => {});
          }

        } catch (error) {
          log.warn(`Attempt #${state.attempts} error: ${error.message}`);
        }

        // Dynamic interval: faster right after 5PM, slower otherwise
        const interval = this._getCheckInterval(state.attempts);
        await delay(interval);
      }

      log.info(`Monitor ended after ${state.attempts} attempts`);
      return { success: false, reason: 'MAX_ATTEMPTS_REACHED' };

    } finally {
      this.activeMonitors.delete(applicationId);
    }
  }

  /**
   * Stop monitoring for an application
   */
  stopMonitor(applicationId) {
    const state = this.activeMonitors.get(applicationId);
    if (state) {
      state.running = false;
      this.activeMonitors.delete(applicationId);
      logger.info(`Monitor stopped: ${applicationId}`);
      return true;
    }
    return false;
  }

  /**
   * Wait until just before 5:00 PM BD time (when slots typically open)
   * Pre-warms 30 seconds before so we're ready to fire immediately
   */
  async _waitUntilSlotTime(log) {
    const slotHour = config.ivac.slotOpenHour;
    const slotMinute = config.ivac.slotOpenMinute ?? 0;
    const prewarmSeconds = config.ivac.slotPrewarmSeconds ?? 30;

    const dhakaParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: config.ivac.timezone || 'Asia/Dhaka',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(new Date());

    const getPart = (type) => parseInt(dhakaParts.find((p) => p.type === type)?.value || '0', 10);
    const hours = getPart('hour');
    const minutes = getPart('minute');
    const seconds = getPart('second');

    const targetSeconds = slotHour * 3600 + slotMinute * 60;
    const currentSeconds = hours * 3600 + minutes * 60 + seconds;
    let waitMs = (targetSeconds - currentSeconds - prewarmSeconds) * 1000;

    if (waitMs < 0) {
      log.info('Already past slot opening window (Asia/Dhaka), starting immediately');
      return;
    }

    const waitMins = Math.max(1, Math.round(waitMs / 60000));
    log.info(`⏳ Waiting ~${waitMins} minutes until slot opening (${config.ivac.timezone})...`);

    await notifier.monitorStarted(waitMins);

    await delay(waitMs);
    log.info('⚡ Slot window reached! Starting rapid polling...');
  }

  /**
   * Dynamic check interval: very fast right after 5PM, then backs off
   */
  _getCheckInterval(attempt) {
    // First 20 attempts: 3-5 seconds (aggressive)
    if (attempt <= 20) return jitter(3000, 5000);
    // Next 30: 5-10 seconds
    if (attempt <= 50) return jitter(5000, 10000);
    // After that: 10-20 seconds
    return jitter(10000, 20000);
  }

  async _navigateToSlotBooking(page, log) {
    log.debug('Navigating to slot booking...');
    const ok = await PO.clickFirstMatch(page, PO.slots.bookingNav, log, 'slots_nav');
    if (ok) {
      await page.waitForLoadState('domcontentloaded');
      await delay(1000, 2000);
      return;
    }
    await page.goto(`${config.ivac.baseUrl}/appointment`, { waitUntil: 'domcontentloaded' });
  }

  async _selectBookingOptions(page, application, log) {
    log.debug('Selecting booking options...');

    if (application.ivacLocation) {
      for (const sel of PO.slots.location) {
        const el = await page.$(sel);
        if (el) {
          await page.selectOption(sel, { label: application.ivacLocation }).catch(() => {
            log.warn('Location dropdown not found');
          });
          break;
        }
      }
      await delay(500, 1000);
    }

    if (application.visaType) {
      for (const sel of PO.slots.visaType) {
        const el = await page.$(sel);
        if (el) {
          await page.selectOption(sel, { label: application.visaType }).catch(() => {
            log.warn('Visa type dropdown not found');
          });
          break;
        }
      }
      await delay(500, 1000);
    }

    await PO.clickFirstMatch(page, PO.slots.checkAvailability, log, 'check_availability');
    await delay(2000, 3000);
  }

  async _checkSlotsAvailable(page, application, log) {
    log.debug('Checking slot availability...');

    const available = [];

    for (const sel of PO.slots.slotCandidates) {
      const elements = await page.$$(sel);
      if (elements.length > 0) {
        log.debug(`Found ${elements.length} potential slots via: ${sel}`);

        for (const el of elements) {
          const text = await el.textContent();
          const isDisabled = await el.getAttribute('disabled');
          const classList = (await el.getAttribute('class')) || '';

          if (!isDisabled &&
              !classList.includes('disabled') &&
              !classList.includes('booked') &&
              !classList.includes('full')) {
            available.push({ element: el, text: text?.trim(), selector: sel });
          }
        }
        if (available.length > 0) break;
      }
    }

    const noSlotTexts = [
      'No slots available', 'No appointment', 'Fully booked',
      'Not available', 'কোনো স্লট নেই',
    ];
    const pageContent = await page.textContent('body').catch(() => '');
    for (const text of noSlotTexts) {
      if (pageContent.includes(text)) {
        return [];
      }
    }

    return available;
  }

  async _findAndSelectSlot(page, application, log) {
    const available = await this._checkSlotsAvailable(page, application, log);
    if (available.length === 0) return false;
    return this._selectBestSlot(available, application, log);
  }

  async _selectBestSlot(available, application, log) {
    log.info(`Selecting best slot from ${available.length} available...`);

    // Priority: preferred dates > earliest available
    let selected = available[0];

    if (application.preferredDates?.length > 0) {
      for (const slot of available) {
        const text = slot.text || '';
        for (const prefDate of application.preferredDates) {
          if (text.includes(prefDate)) {
            selected = slot;
            log.info(`Selected preferred date slot: ${text}`);
            break;
          }
        }
      }
    }

    // Click the slot
    try {
      await selected.element.click();
      await delay(500, 1000);
      return true;
    } catch {
      return false;
    }
  }

  async _selectAndConfirmSlot(page, available, application, log) {
    const clicked = await this._selectBestSlot(available, application, log);
    if (!clicked) return { success: false, reason: 'SLOT_SELECTION_FAILED' };

    // Group booking: attendee entry can add significant latency; extend timeouts and fill attendees.
    if (application.attendees?.length > 0) {
      const multiplier = 1 + Math.min(3, application.attendees.length) * 0.5;
      const timeoutMs = Math.round((config.browser.timeout || 30000) * multiplier);
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);
      await this._addAttendees(page, application.attendees, log);
    }

    await this._confirmBooking(page, log);
    const appointment = await this._getAppointmentDetails(page, log);
    return { success: true, appointment };
  }

  async _addAttendees(page, attendees, log) {
    log.debug(`Adding ${attendees.length} attendee(s)...`);

    for (let i = 0; i < attendees.length && i < 3; i++) {
      const attendee = attendees[i];
      const addBtn = await page.$(`#addAttendee${i + 1}, .add-attendee:nth-child(${i + 1}), button:has-text("Add Attendee")`);
      if (addBtn) {
        await addBtn.click();
        await delay(500, 1000);
      }

      // Fill attendee fields
      const prefix = `#attendee${i + 1}, input[name*="attendee[${i}]"]`;
      await page.fill(`${prefix}[name*="name"]`, attendee.name || '').catch(() => {});
      await page.fill(`${prefix}[name*="passport"]`, attendee.passport || '').catch(() => {});
    }
  }

  async _confirmBooking(page, log) {
    log.debug('Confirming booking...');
    await delay(500, 1000);
    const ok = await PO.clickFirstMatch(page, PO.slots.confirm, log, 'slot_confirm');
    if (!ok) throw new Error('Confirm booking button not found');
    await delay(3000, 5000);
    log.debug('Booking submitted');
  }

  async _getAppointmentDetails(page, log) {
    log.debug('Extracting appointment details...');
    await page.waitForLoadState('domcontentloaded');

    const details = {
      token: null,
      date: null,
      time: null,
      centre: null,
      confirmationNumber: null,
    };

    const patterns = {
      token: /Token\s*(?:No\.?)?\s*:?\s*([A-Z0-9\-]+)/i,
      date: /(?:Appointment|Date)\s*:?\s*([\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{4})/i,
      time: /Time\s*:?\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
      confirmationNumber: /(?:Confirmation|Reference)\s*(?:No\.?)?\s*:?\s*([A-Z0-9\-]+)/i,
    };

    const text = await page.textContent('body').catch(() => '');
    for (const [key, regex] of Object.entries(patterns)) {
      const match = text.match(regex);
      if (match) details[key] = match[1].trim();
    }

    for (const sel of PO.slots.token) {
      const el = await page.$(sel);
      if (el) {
        details.token = details.token || (await el.textContent())?.trim() || null;
        break;
      }
    }

    return details;
  }

  get monitorCount() {
    return this.activeMonitors.size;
  }

  getMonitorStatus() {
    const status = {};
    for (const [appId, state] of this.activeMonitors) {
      status[appId] = {
        running: state.running,
        attempts: state.attempts,
      };
    }
    return status;
  }
}

module.exports = new SlotBooker();
