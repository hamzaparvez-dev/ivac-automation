// src/modules/fileUploader.js
const fs = require('fs');
const logger = require('../services/logger');
const PO = require('../ivac/pageObjects');

const delay = (min, max) =>
  new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

class FileUploader {
  async uploadFiles(page, files, applicantData, sessionId) {
    const log = logger.forApp(sessionId);
    log.info('Starting file upload process...');

    await this._navigateToUpload(page, log, sessionId);
    await this._fillApplicationDetails(page, applicantData, log, sessionId);

    if (!files.bgdPdf) throw new Error('BGD PDF is required for upload');
    const bgdOk = await this._uploadDocument(page, files.bgdPdf, 'bgd', log);
    if (!bgdOk) throw new Error('BGD upload failed');

    if (files.photo) {
      await this._uploadDocument(page, files.photo, 'photo', log);
    }
    if (files.supportingDocs?.length) {
      for (const doc of files.supportingDocs) {
        // Supporting docs are optional; fail if explicitly provided but missing.
        const ok = await this._uploadDocument(page, doc.path, doc.type || 'default', log);
        if (!ok) throw new Error(`Supporting document upload failed: ${doc.path}`);
      }
    }

    const confirmed = await this._confirmUpload(page, log);
    if (!confirmed) throw new Error('Upload confirm button not found');
    log.info('File upload completed');
    return { success: true };
  }

  async _navigateToUpload(page, log, sessionId) {
    log.debug('Navigating to file upload...');
    const ok = await PO.clickFirstMatch(page, PO.upload.nav, log, 'upload_nav');
    if (ok) {
      await page.waitForLoadState('domcontentloaded');
      await delay(1000, 2000);
      return;
    }
    await PO.selectorMissScreenshot(page, sessionId, 'upload_nav');
    log.warn('Upload navigation not found, assuming already on upload page');
  }

  async _fillApplicationDetails(page, data, log, sessionId) {
    log.debug('Filling application details...');
    const pairs = [
      [PO.upload.location, data.ivacLocation, 'location'],
      [PO.upload.visaType, data.visaType, 'visaType'],
      [PO.upload.passport, data.passportNumber, 'passport'],
    ];
    for (const [selectors, value, name] of pairs) {
      if (!value) continue;
      let filled = false;
      for (const sel of selectors) {
        const el = await page.$(sel);
        if (el) {
          const tag = await el.evaluate((e) => e.tagName.toLowerCase());
          if (tag === 'select') {
            await page.selectOption(sel, { label: value }).catch(() => {});
          } else {
            await el.fill(value);
          }
          filled = true;
          await delay(200, 500);
          break;
        }
      }
      if (!filled) await PO.selectorMissScreenshot(page, sessionId, `upload_${name}`);
    }
  }

  async _uploadDocument(page, filePath, docType, log) {
    log.debug(`Uploading ${docType}: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      log.warn(`File not found: ${filePath}`);
      return false;
    }

    const map = {
      bgd: PO.upload.bgd,
      photo: PO.upload.photo,
      passport: PO.upload.passportDoc,
      default: PO.upload.defaultFile,
    };
    const selectors = map[docType] || map.default;

    for (const sel of selectors) {
      const els = await page.$$(sel);
      for (const el of els) {
        try {
          await el.setInputFiles(filePath);
          await delay(1500, 3000);
          log.debug(`${docType} uploaded via ${sel}`);
          await this._waitForUploadComplete(page, log);
          return true;
        } catch (e) {
          /* try next */
        }
      }
    }

    log.warn(`Could not find upload input for ${docType}`);
    return false;
  }

  async _waitForUploadComplete(page, log) {
    for (const sel of PO.upload.spinners) {
      try {
        await page.waitForSelector(sel, { state: 'hidden', timeout: 30000 });
      } catch {
        /* */
      }
    }
    await delay(1000, 2000);
  }

  async _confirmUpload(page, log) {
    log.debug('Confirming upload...');
    await delay(500, 1000);
    return PO.clickFirstMatch(page, PO.upload.confirm, log, 'upload_confirm');
  }
}

module.exports = new FileUploader();
