// src/services/notifier.js
// Multi-channel notifications: Telegram Bot + Email
const axios = require('axios');
const config = require('../config/config');
const logger = require('./logger');

class Notifier {
  async _telegram(message) {
    if (!config.notification.telegram.botToken) return;
    try {
      await axios.post(
        `https://api.telegram.org/bot${config.notification.telegram.botToken}/sendMessage`,
        {
          chat_id: config.notification.telegram.chatId,
          text: message,
          parse_mode: 'HTML',
        },
        { timeout: 10000 }
      );
    } catch (e) {
      logger.warn(`Telegram notification failed: ${e.message}`);
    }
  }

  async _email(subject, body) {
    if (!config.notification.email.user) return;
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: config.notification.email.host,
        port: config.notification.email.port,
        auth: {
          user: config.notification.email.user,
          pass: config.notification.email.pass,
        },
      });
      await transporter.sendMail({
        from: config.notification.email.user,
        to: config.notification.email.notifyEmail || config.notification.email.user,
        subject,
        text: body,
      });
    } catch (e) {
      logger.warn(`Email notification failed: ${e.message}`);
    }
  }

  async slotBooked(application, appointment) {
    const msg = `
✅ <b>SLOT BOOKED!</b>

👤 Applicant: ${application.applicantName || application.phone}
📍 Location: ${application.ivacLocation}
🛂 Visa: ${application.visaType}
📅 Date: ${appointment?.date || 'TBD'}
⏰ Time: ${appointment?.time || 'TBD'}
🎫 Token: ${appointment?.token || 'TBD'}
    `.trim();

    await this._telegram(msg);
    await this._email('IVAC Slot Booked!', msg.replace(/<[^>]+>/g, ''));
  }

  async pipelineProgress(application, message) {
    await this._telegram(`⚙️ <b>${application.applicantName || application.phone}</b>\n${message}`);
  }

  async paymentRequired(application, payResult) {
    const msg = `
⚠️ <b>PAYMENT REQUIRED</b>

👤 ${application.applicantName}
💰 Amount: BDT ${payResult.amount || 1500}
🔗 Pay: ${payResult.paymentUrl || 'Login to IVAC to pay'}
    `.trim();
    await this._telegram(msg);
  }

  async failed(application, error) {
    const msg = `
❌ <b>PIPELINE FAILED</b>

👤 ${application.applicantName || application.phone}
❗ Error: ${error.message}
    `.trim();
    await this._telegram(msg);
  }

  async monitorStarted(waitMins) {
    await this._telegram(`⏳ <b>Slot Monitor Started</b>\nWaiting ${waitMins} min until 5:00 PM BD time...`);
  }

  async success(application) {
    await this._telegram(`🎉 <b>COMPLETE!</b> ${application.applicantName} - Fully processed!`);
  }
}

module.exports = new Notifier();
