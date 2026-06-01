// src/config/config.js
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const rootEnv = path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
} else {
  dotenv.config();
}

module.exports = {
  app: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
    jwtSecret: process.env.JWT_SECRET || 'change-me',
  },

  db: {
    mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/ivac_automation',
    /** Reserved for a future Bull/Redis worker — not used by in-process p-queue */
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    /** Options passed to mongoose.connect (Atlas-friendly defaults) */
    mongoOptions: {
      serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10) || 30_000,
      socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS, 10) || 45_000,
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE, 10) || 10,
    },
  },

  ivac: {
    baseUrl: process.env.IVAC_BASE_URL || 'https://www.ivacbd.com',
    onlineUrl: process.env.IVAC_ONLINE_URL || 'https://www.ivacbd.com/for-bangladeshi',
    loginUrl: process.env.IVAC_LOGIN_URL || 'https://www.ivacbd.com/login',
    slotCheckInterval: parseInt(process.env.IVAC_SLOT_CHECK_INTERVAL, 10) || 5000,
    slotOpenHour: parseInt(process.env.IVAC_SLOT_OPEN_HOUR, 10) || 17,
    slotOpenMinute: parseInt(process.env.IVAC_SLOT_OPEN_MINUTE, 10) || 0,
    slotPrewarmSeconds: parseInt(process.env.IVAC_SLOT_PREWARM_SECONDS, 10) || 30,
    timezone: process.env.IVAC_TIMEZONE || 'Asia/Dhaka',
    locations: {
      dhaka_gulshan: 'Dhaka (Gulshan)',
      dhaka_jfp: 'Dhaka (Jamuna Future Park)',
      dhaka_dhanmondi: 'Dhaka (Dhanmondi)',
      chittagong: 'Chittagong',
      rajshahi: 'Rajshahi',
      sylhet: 'Sylhet',
      khulna: 'Khulna',
      jessore: 'Jessore',
      barisal: 'Barisal',
      mymensingh: 'Mymensingh',
      rangpur: 'Rangpur',
      comilla: 'Comilla',
    },
    visaTypes: [
      'Tourist', 'Medical', 'Business', 'Student',
      'Employment', 'Conference', 'Research', 'Transit',
      'Entry (X)', 'Visit',
    ],
  },

  browser: {
    headless: process.env.HEADLESS !== 'false',
    timeout: parseInt(process.env.BROWSER_TIMEOUT, 10) || 30000,
    slowMo: parseInt(process.env.SLOW_MO, 10) || 50,
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_BROWSERS, 10) || 5,
    /** Block images/fonts for speed — can look non-human; default off (set BLOCK_MEDIA=true to force) */
    blockMedia: process.env.BLOCK_MEDIA === 'true',
    /** Slot-monitor login iterations often set blockMedia true unless SLOT_MONITOR_BLOCK_MEDIA=false */
    blockMediaSlotMonitor: process.env.SLOT_MONITOR_BLOCK_MEDIA !== 'false',
    traceOnFailure: process.env.TRACE_ON_FAILURE === 'true',
    debugPw: process.env.DEBUG_PW === 'true',
    proxyList: (process.env.PROXY_LIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    /** Desktop Chrome/Edge only — must stay aligned with 1920×1080 viewport in browser.js */
    userAgents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Edg/124.0.0.0 Safari/537.36',
    ],
  },

  otp: {
    serverUrl: process.env.OTP_SERVER_URL,
    apiKey: process.env.OTP_SERVER_API_KEY,
    /** Shared secret for POST /api/otp/webhook (falls back to apiKey) */
    webhookSecret: process.env.OTP_WEBHOOK_SECRET || process.env.OTP_SERVER_API_KEY,
    waitTimeout: parseInt(process.env.OTP_WAIT_TIMEOUT, 10) || 120000,
    pollInterval: parseInt(process.env.OTP_POLL_INTERVAL, 10) || 3000,
    /** MiMSMS inbound SMS (primary OTP source for Bangladesh) */
    mimsms: {
      apiKey: process.env.MIMSMS_API_KEY,
      apiToken: process.env.MIMSMS_API_TOKEN,
      virtualNumber: process.env.MIMSMS_VIRTUAL_NUMBER,
      baseUrl: process.env.MIMSMS_BASE_URL || 'https://www.mimsms.com.bd/smsAPI',
      pollInterval: parseInt(process.env.MIMSMS_POLL_INTERVAL_MS, 10) || 3000,
      inboxList: process.env.MIMSMS_INBOX_LIST || 'unread',
    },
  },

  security: {
    corsOrigins: (process.env.CORS_ORIGINS || '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
    webhookRateLimitMax: parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX, 10) || 60,
  },

  captcha: {
    service: process.env.CAPTCHA_SERVICE || '2captcha',
    twoCaptchaKey: process.env.TWOCAPTCHA_API_KEY,
    antiCaptchaKey: process.env.ANTICAPTCHA_API_KEY,
  },

  notification: {
    email: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      notifyEmail: process.env.NOTIFY_EMAIL,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    },
  },

  payment: {
    sslcommerz: {
      storeId: process.env.SSLCOMMERZ_STORE_ID,
      storePassword: process.env.SSLCOMMERZ_STORE_PASSWD,
      sandbox: process.env.SSLCOMMERZ_SANDBOX !== 'false',
    },
    bkash: {
      phone: process.env.BKASH_PHONE,
      pin: process.env.BKASH_PIN,
    },
    card: {
      number: process.env.CARD_NUMBER,
      expiry: process.env.CARD_EXPIRY,
      cvv: process.env.CARD_CVV,
      name: process.env.CARD_NAME,
    },
  },

  retry: {
    maxRetries: parseInt(process.env.MAX_RETRIES) || 5,
    retryDelay: parseInt(process.env.RETRY_DELAY) || 3000,
  },

  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY, 10) || 3,
    /** Max pipelines waiting; beyond this API returns 503 */
    maxWaiting: parseInt(process.env.PIPELINE_QUEUE_MAX_WAITING, 10) || 30,
  },
};
