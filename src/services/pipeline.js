// src/services/pipeline.js
// End-to-end orchestrator: BGD Extract → Register → Upload → Slots → Payment
const pdfExtractor = require('./pdfExtractor');
const registrationModule = require('../modules/registration');
const loginModule = require('../modules/login');
const fileUploader = require('../modules/fileUploader');
const slotBooker = require('../modules/slotBooker');
const paymentModule = require('../modules/payment');
const notifier = require('./notifier');
const logger = require('./logger');
const browserManager = require('../modules/browser');
const Application = require('../api/models/application');
const { v4: uuidv4 } = require('uuid');

class Pipeline {
  async _updateApplication(application, status, details = {}) {
    application.status = status;
    application.logs.push({ status, timestamp: new Date(), ...details });
    await application.save().catch(() => {});
    logger.forApp(application.pipelineId).info(`📍 Status: ${status}`);
  }

  /**
   * After slot is booked: fresh login, payment flow, always close browser.
   */
  async _runPaymentPhase(application, loginCredentials, applicantDisplayName, paymentMode, pipelineId) {
    const log = logger.forApp(pipelineId);

    if (paymentMode === 'manual') {
      await this._updateApplication(application, 'AWAITING_PAYMENT');
      log.info('Payment mode manual — awaiting user action');
      return { paid: false, skipped: true };
    }

    await this._updateApplication(application, 'PROCESSING_PAYMENT');

    const paySessionId = `pay_${pipelineId}`;
    let payLoginResult;

    try {
      payLoginResult = await loginModule.login(
        loginCredentials.phone,
        loginCredentials.password,
        { sessionId: paySessionId }
      );

      const payResult = await paymentModule.processPayment(
        payLoginResult.page,
        {
          applicantName: applicantDisplayName,
          applicationId: application._id.toString(),
        },
        paymentMode,
        paySessionId
      );

      if (payResult.amount != null) {
        application.paymentAmount = payResult.amount;
      }

      if (payResult.success) {
        application.paymentStatus = 'PAID';
        await this._updateApplication(application, 'COMPLETED');
        await notifier.success(application);
        log.info('🎉 Payment completed successfully');
        return { paid: true, payResult };
      }

      application.paymentStatus = 'PENDING';
      await this._updateApplication(application, 'PAYMENT_PENDING', {
        paymentUrl: payResult.paymentUrl,
      });
      await notifier.paymentRequired(application, payResult);
      log.info('⚠️ Slot secured; complete payment manually if needed');
      return { paid: false, payResult };
    } finally {
      if (payLoginResult?.sessionId) {
        await browserManager.close(payLoginResult.sessionId).catch(() => {});
      }
    }
  }

  /**
   * FULL AUTOMATED PIPELINE
   * Pass applicationId when the API has already created the Application row (recommended).
   */
  async runFullPipeline(params) {
    const {
      applicationId,
      bgdPdfPath,
      ivacPassword,
      ivacLocation,
      visaType,
      photoPath,
      paymentMode = 'self',
      attendees = [],
      preferredDates = [],
      agentId,
      supportingDocs = [],
    } = params;

    let application;

    if (applicationId) {
      application = await Application.findById(applicationId);
      if (!application) {
        throw new Error(`Application not found: ${applicationId}`);
      }
    } else {
      const pipelineId = uuidv4();
      application = await Application.create({
        pipelineId,
        agentId,
        status: 'PROCESSING',
        ivacLocation,
        visaType,
        paymentMode,
        attendees,
        preferredDates,
        logs: [],
      });
    }

    const pipelineId = application.pipelineId;
    const log = logger.forApp(pipelineId);

    log.info('🚀 Starting Full Automated Pipeline');
    log.info(`  Location: ${ivacLocation}, Visa: ${visaType}`);

    const updateStatus = async (status, details = {}) => {
      await this._updateApplication(application, status, details);
    };

    try {
      await updateStatus('EXTRACTING_PDF');
      const applicantData = await pdfExtractor.extract(bgdPdfPath);
      applicantData.ivacLocation = ivacLocation;
      applicantData.visaType = visaType;
      if (!applicantData.fullName) {
        const parts = [applicantData.surname, applicantData.givenName].filter(Boolean);
        if (parts.length) applicantData.fullName = parts.join(' ').replace(/\s+/g, ' ').trim();
      }

      // Fail-fast: required fields must exist before attempting live IVAC steps.
      const bdPhoneOk = typeof applicantData.phone === 'string' && /^01[3-9]\d{8}$/.test(applicantData.phone);
      if (!applicantData.passportNumber || !bdPhoneOk || !applicantData.email || !applicantData.fullName) {
        const missing = [
          !applicantData.passportNumber ? 'passportNumber' : null,
          !bdPhoneOk ? 'phone' : null,
          !applicantData.email ? 'email' : null,
          !applicantData.fullName ? 'fullName' : null,
        ].filter(Boolean);
        throw new Error(`PDF extraction missing required fields: ${missing.join(', ')}`);
      }

      application.applicantName = applicantData.fullName;
      application.passportNumber = applicantData.passportNumber;
      application.phone = applicantData.phone;
      application.email = applicantData.email;
      await application.save().catch(() => {});

      log.info(`✅ PDF extracted: ${applicantData.fullName} | ${applicantData.passportNumber}`);

      await updateStatus('REGISTERING');
      let loginCredentials;

      try {
        const regResult = await registrationModule.register(
          applicantData,
          applicantData.phone,
          ivacPassword,
          applicantData.email,
          photoPath
        );

        loginCredentials = {
          phone: applicantData.phone,
          password: ivacPassword,
          storageState: regResult.storageState,
        };
        application.ivacRegistered = true;
        await application.save().catch(() => {});
        log.info('✅ IVAC registration completed');
      } catch (regErr) {
        if (regErr.message?.includes('already registered')) {
          log.info('Account already registered, proceeding with login');
          loginCredentials = { phone: applicantData.phone, password: ivacPassword };
        } else {
          throw regErr;
        }
      }

      await updateStatus('LOGGING_IN');
      const loginResult = await loginModule.login(
        loginCredentials.phone,
        loginCredentials.password,
        { sessionId: pipelineId }
      );

      try {
        log.info('✅ Login successful');

        await updateStatus('UPLOADING_FILES');
        const attendeeDocs = (attendees || [])
          .map((a) => a?.bgdPdfPath)
          .filter(Boolean)
          .map((p) => ({ path: p, type: 'default' }));
        const uploadResult = await fileUploader.uploadFiles(
          loginResult.page,
          {
            bgdPdf: bgdPdfPath,
            photo: photoPath,
            supportingDocs: [...(supportingDocs || []), ...attendeeDocs],
          },
          applicantData,
          pipelineId
        );
        if (!uploadResult?.success) {
          throw new Error(uploadResult?.reason || 'File upload failed');
        }
        application.filesUploaded = true;
        await application.save().catch(() => {});
        log.info('✅ Files uploaded');
      } finally {
        await browserManager.close(loginResult.sessionId).catch(() => {});
      }

      await updateStatus('MONITORING_SLOTS');
      await notifier.pipelineProgress(application, 'Monitoring for appointment slots...');

      const bookingResult = await slotBooker.monitorAndBook(
        loginCredentials,
        {
          applicationId: application._id.toString(),
          ivacLocation,
          visaType,
          preferredDates,
          attendees,
        },
        { startAt5PM: true }
      );

      if (!bookingResult.success) {
        await updateStatus('SLOT_NOT_FOUND', { reason: bookingResult.reason });
        throw new Error(`Slot booking failed: ${bookingResult.reason}`);
      }

      application.appointment = bookingResult.appointment;
      await updateStatus('SLOT_BOOKED', { appointment: bookingResult.appointment });
      log.info(`✅ Slot booked: Token ${bookingResult.appointment?.token}`);
      await notifier.slotBooked(application, bookingResult.appointment);

      await this._runPaymentPhase(
        application,
        loginCredentials,
        applicantData.fullName || applicantData.phone,
        paymentMode,
        pipelineId
      );

      return { success: true, application: application.toObject() };
    } catch (error) {
      log.error(`Pipeline failed: ${error.message}`);
      await this._updateApplication(application, 'FAILED', { error: error.message });
      await notifier.failed(application, error);
      return { success: false, error: error.message, application: application.toObject() };
    }
  }

  /**
   * EXISTING ACCOUNT: slot monitor → book → payment (same as full pipeline tail).
   */
  async runExistingAccountPipeline(params) {
    const {
      applicationId,
      ivacPhone,
      ivacPassword,
      ivacEmail,
      ivacLocation,
      visaType,
      paymentMode = 'self',
      attendees = [],
      preferredDates = [],
      agentId,
    } = params;

    let application;

    if (applicationId) {
      application = await Application.findById(applicationId);
      if (!application) {
        throw new Error(`Application not found: ${applicationId}`);
      }
    } else {
      const pipelineId = uuidv4();
      application = await Application.create({
        pipelineId,
        agentId,
        status: 'MONITORING_SLOTS',
        phone: ivacPhone,
        email: ivacEmail,
        ivacLocation,
        visaType,
        paymentMode,
        attendees,
        preferredDates,
        ivacRegistered: true,
        logs: [],
      });
    }

    const pipelineId = application.pipelineId;
    const log = logger.forApp(pipelineId);
    log.info('🚀 Starting Existing Account Pipeline (slots → payment)');

    const loginCredentials = { phone: ivacPhone, password: ivacPassword };
    const applicantDisplay =
      application.applicantName || ivacEmail || ivacPhone;

    try {
      application.status = 'MONITORING_SLOTS';
      await application.save().catch(() => {});

      const bookingResult = await slotBooker.monitorAndBook(
        loginCredentials,
        {
          applicationId: application._id.toString(),
          ivacLocation,
          visaType,
          preferredDates,
          attendees,
        },
        { startAt5PM: true }
      );

      if (!bookingResult.success) {
        application.status = 'SLOT_NOT_FOUND';
        application.logs.push({
          status: 'SLOT_NOT_FOUND',
          timestamp: new Date(),
          reason: bookingResult.reason,
        });
        await application.save().catch(() => {});
        return { success: false, reason: bookingResult.reason, application: application.toObject() };
      }

      application.appointment = bookingResult.appointment;
      application.status = 'SLOT_BOOKED';
      application.logs.push({
        status: 'SLOT_BOOKED',
        timestamp: new Date(),
        appointment: bookingResult.appointment,
      });
      await application.save().catch(() => {});

      await notifier.slotBooked(application, bookingResult.appointment);

      await this._runPaymentPhase(
        application,
        loginCredentials,
        applicantDisplay,
        paymentMode,
        pipelineId
      );

      return { success: true, application: application.toObject() };
    } catch (error) {
      log.error(`Existing account pipeline failed: ${error.message}`);
      application.status = 'FAILED';
      application.logs.push({
        status: 'FAILED',
        timestamp: new Date(),
        error: error.message,
      });
      await application.save().catch(() => {});
      await notifier.failed(application, error);
      return { success: false, error: error.message, application: application.toObject() };
    }
  }
}

module.exports = new Pipeline();
