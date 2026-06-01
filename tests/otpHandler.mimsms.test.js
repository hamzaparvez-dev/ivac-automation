const { test } = require('node:test');
const assert = require('node:assert');

const otpHandler = require('../src/modules/otpHandler');

test('_findOtpInInbox filters by virtual number and wait start time', () => {
  const waitStart = new Date('2026-06-01T10:00:00+06:00').getTime();
  const inbox = [
    {
      id: '1',
      from: '123456789',
      to: '2347015272',
      message: 'Your IVAC OTP code is 111111',
      date: '2026-06-01 09:59:00',
    },
    {
      id: '2',
      from: '123456789',
      to: '9999999999',
      message: 'Your IVAC OTP code is 222222',
      date: '2026-06-01 10:01:00',
    },
    {
      id: '3',
      from: '123456789',
      to: '2347015272',
      message: 'Your IVAC OTP code is 333333',
      date: '2026-06-01 10:01:30',
    },
  ];

  const otp = otpHandler._findOtpInInbox(inbox, '01701527200', waitStart, '2347015272');
  assert.strictEqual(otp, '333333');
});

test('_findOtpInInbox skips already processed message ids', () => {
  otpHandler.processedMessageIds.add('10');
  const waitStart = new Date('2026-06-01T10:00:00+06:00').getTime();
  const inbox = [
    {
      id: '10',
      to: '2347015272',
      message: 'OTP 444444',
      date: '2026-06-01 10:00:30',
    },
    {
      id: '11',
      to: '2347015272',
      message: 'OTP 555555',
      date: '2026-06-01 10:01:00',
    },
  ];

  const otp = otpHandler._findOtpInInbox(inbox, '01700000000', waitStart, '2347015272');
  assert.strictEqual(otp, '555555');
  otpHandler.processedMessageIds.delete('10');
  otpHandler.processedMessageIds.delete('11');
});

test('_parseMiMSMSDate parses BD local timestamp', () => {
  const d = otpHandler._parseMiMSMSDate('2019-02-10 13:37:51');
  assert.ok(d instanceof Date);
  assert.strictEqual(d.getUTCHours(), 7);
  assert.strictEqual(d.getUTCMinutes(), 37);
});

test('_extractOtp finds 6-digit code in IVAC SMS', () => {
  assert.strictEqual(
    otpHandler._extractOtp('Your IVAC OTP code is 123456'),
    '123456'
  );
});
