/**
 * Central IVAC DOM selectors — update here when ivacbd.com markup changes.
 * Regenerate hints: npx playwright codegen https://www.ivacbd.com/login
 */
const path = require('path');

const logsDir = path.join(__dirname, '../../logs');

async function firstVisible(page, selectors, timeout = 2500) {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { state: 'visible', timeout });
      if (el) return { element: el, selector: sel };
    } catch {
      /* next */
    }
  }
  return null;
}

async function clickFirstMatch(page, selectors, log, screenId = 'unknown') {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      return true;
    }
  }
  if (log) log.warn(`pageObjects: no click target for ${screenId}`);
  return false;
}

async function fillFirstMatch(page, selectors, value, log, screenId = 'field') {
  if (!value) return false;
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.fill(value);
      return true;
    }
  }
  if (log) log.warn(`pageObjects: no fill target for ${screenId}`);
  return false;
}

async function selectorMissScreenshot(page, sessionId, screenId) {
  try {
    const safe = String(screenId).replace(/[^a-z0-9_-]/gi, '_');
    await page.screenshot({
      path: path.join(logsDir, `miss_${sessionId}_${safe}.png`),
      fullPage: true,
    });
  } catch {
    /* ignore */
  }
}

const register = {
  entry: [
    'a[href*="register"]',
    'a[href*="signup"]',
    'button:has-text("Register")',
    'a:has-text("Apply Online")',
    '.register-btn',
    '#registerBtn',
  ],
  passport: ['#passportNo', 'input[name*="passport"]', 'input[placeholder*="Passport"]'],
  surname: ['#surname', 'input[name*="surname"]', 'input[placeholder*="Surname"]'],
  givenName: ['#givenName', 'input[name*="given"]', 'input[placeholder*="Given"]'],
  dob: ['#dob', 'input[name*="dob"]', 'input[placeholder*="Date of Birth"]'],
  phone: ['#mobile', 'input[name*="mobile"]', 'input[name*="phone"]', 'input[placeholder*="Mobile"]'],
  email: ['#email', 'input[name*="email"]', 'input[placeholder*="Email"]'],
  password: ['#password', 'input[name*="password"][type="password"]'],
  confirmPassword: ['#confirmPassword', 'input[name*="confirm"]', 'input[name*="retype"]'],
  gender: ['select[name*="gender"]', '#gender'],
  nationality: ['select[name*="nationality"]', '#nationality'],
  photoFile: [
    'input[type="file"][name*="photo"]',
    'input[type="file"][accept*="image"]',
    '#photoUpload',
    '.photo-upload input',
  ],
  submit: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Register")',
    'button:has-text("Send OTP")',
    '.submit-btn',
    '#submitBtn',
  ],
  otp: [
    '#otp',
    'input[name*="otp"]',
    'input[placeholder*="OTP"]',
    'input[maxlength="6"]',
    '.otp-input',
  ],
  otpVerify: ['button:has-text("Verify")', 'button:has-text("Submit")', '#verifyOtp'],
  success: ['.success-message', '.alert-success', 'div:has-text("successfully")', 'div:has-text("registered")'],
};

const login = {
  phone: [
    '#mobile',
    '#phone',
    '#username',
    'input[name*="mobile"]',
    'input[name*="phone"]',
    'input[placeholder*="Mobile"]',
    'input[placeholder*="Phone"]',
    'input[type="tel"]',
  ],
  password: [
    '#password',
    'input[name="password"]',
    'input[type="password"]',
    'input[placeholder*="Password"]',
  ],
  submit: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Login")',
    'button:has-text("Sign In")',
    '#loginBtn',
    '.login-btn',
  ],
  otp: ['#otp', 'input[name*="otp"]', 'input[placeholder*="OTP"]', 'input[maxlength="6"]'],
  otpVerify: ['button:has-text("Verify")', 'button:has-text("Submit")', '#verifyBtn'],
  success: [
    '.dashboard',
    '#dashboard',
    '.user-panel',
    'a:has-text("Logout")',
    'a:has-text("Sign Out")',
    '.welcome-msg',
    '.user-name',
  ],
};

const upload = {
  nav: [
    'a:has-text("Upload")',
    'a:has-text("Documents")',
    'a[href*="upload"]',
    'a[href*="document"]',
    '.upload-section',
    '#uploadSection',
  ],
  location: ['select[name*="location"]', '#location'],
  visaType: ['select[name*="visa_type"]', '#visaType'],
  passport: ['input[name*="passport"]', '#passportNo'],
  bgd: [
    'input[name*="bgd"]',
    'input[name*="form"]',
    'input[accept=".pdf"]',
    '#bgdUpload',
  ],
  photo: [
    'input[name*="photo"]',
    'input[accept="image/*"]',
    '#photoInput',
    'input[name*="image"]',
  ],
  passportDoc: ['input[name*="passport"]', '#passportDoc'],
  defaultFile: ['input[type="file"]'],
  spinners: ['.upload-progress', '.loading', '#uploadSpinner', '.spinner'],
  confirm: [
    'button:has-text("Submit")',
    'button:has-text("Continue")',
    'button:has-text("Next")',
    'button:has-text("Confirm")',
    '#submitUpload',
    '.confirm-btn',
  ],
};

const slots = {
  bookingNav: [
    'a:has-text("Book Appointment")',
    'a:has-text("Slot Booking")',
    'a[href*="appointment"]',
    'a[href*="booking"]',
    '.book-appointment',
    '#bookAppointment',
  ],
  location: ['select[name*="location"]', 'select[name*="centre"]', '#location'],
  visaType: ['select[name*="visa_type"]', 'select[name*="category"]', '#visaType'],
  checkAvailability: [
    'button:has-text("Check")',
    'button:has-text("Search")',
    'button:has-text("Availability")',
    '#checkSlots',
  ],
  slotCandidates: [
    '.slot-available',
    '.available-slot',
    '.open-slot',
    'td.available',
    'button.slot:not(.disabled):not(.booked)',
    '.calendar-day:not(.disabled)',
    '.time-slot.available',
    'input[type="radio"]:not([disabled])',
  ],
  confirm: [
    'button:has-text("Confirm")',
    'button:has-text("Book")',
    'button:has-text("Submit")',
    'button:has-text("Proceed")',
    '#confirmBooking',
    '.confirm-booking',
  ],
  token: ['#tokenNo', '.token-number', '.appointment-token'],
  attendeeAdd: ['button:has-text("Add Attendee")'],
};

const payment = {
  nav: [
    'a:has-text("Pay")',
    'a:has-text("Payment")',
    'a[href*="payment"]',
    'button:has-text("Pay Now")',
    '#payNow',
    '.payment-btn',
  ],
  amount: ['#totalAmount', '.payment-amount', '.total-fee', 'span:has-text("BDT")', '.amount'],
  payNow: ['button:has-text("Pay")', 'input[value="Pay"]', '#payBtn', '.pay-now'],
  bkash: ['img[alt*="bKash"]', 'button:has-text("bKash")', '[data-method="bkash"]'],
  card: ['[data-method="card"]', 'img[alt*="VISA"]', 'img[alt*="MasterCard"]'],
  success: [
    '.payment-success',
    '.success-message',
    '#successMsg',
    'div:has-text("successful")',
    'div:has-text("Payment Successful")',
  ],
};

const captcha = {
  sitekey: ['[data-sitekey]', '.g-recaptcha'],
  iframe: ['iframe[src*="recaptcha"]', 'iframe[title*="reCAPTCHA"]'],
};

module.exports = {
  register,
  login,
  upload,
  slots,
  payment,
  captcha,
  firstVisible,
  clickFirstMatch,
  fillFirstMatch,
  selectorMissScreenshot,
};
