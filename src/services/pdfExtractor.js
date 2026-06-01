// src/services/pdfExtractor.js
// Extracts applicant data from Indian Visa BGD (Bangladesh) PDF application forms
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class PdfExtractor {
  /**
   * Extract all applicant data from a BGD PDF file
   * @param {string} filePath - Path to the PDF file
   * @returns {object} Extracted applicant data
   */
  async extract(filePath) {
    logger.info(`Extracting data from PDF: ${filePath}`);

    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;

    const extracted = {
      // Personal Info
      surname: this._extract(text, /Surname\s*:?\s*([A-Z\s]+)/i),
      givenName: this._extract(text, /Given\s*Name[s]?\s*:?\s*([A-Z\s]+)/i),
      fullName: null,
      gender: this._extractGender(text),
      dateOfBirth: this._extractDate(text, /Date\s*of\s*Birth\s*:?\s*([\d\/\-\.]+)/i),
      placeOfBirth: this._extract(text, /Place\s*of\s*Birth\s*:?\s*([A-Za-z\s,]+)/i),
      nationality: this._extract(text, /Nationality\s*:?\s*([A-Za-z\s]+)/i) || 'BANGLADESHI',
      religion: this._extract(text, /Religion\s*:?\s*([A-Za-z\s]+)/i),
      maritalStatus: this._extractMaritalStatus(text),
      occupation: this._extract(text, /(?:Occupation|Profession)\s*:?\s*([A-Za-z\s]+)/i),

      // Passport
      passportNumber: this._extract(text, /Passport\s*(?:No|Number)\s*\.?\s*:?\s*([A-Z]{1,2}\d{7,10})/i),
      passportType: this._extract(text, /Passport\s*Type\s*:?\s*([A-Za-z\s]+)/i) || 'ORDINARY',
      passportIssueDate: this._extractDate(text, /(?:Date\s*of\s*Issue|Issue\s*Date)\s*:?\s*([\d\/\-\.]+)/i),
      passportExpiryDate: this._extractDate(text, /(?:Date\s*of\s*Expiry|Expiry\s*Date)\s*:?\s*([\d\/\-\.]+)/i),
      passportIssuedAt: this._extract(text, /(?:Issued\s*At|Place\s*of\s*Issue)\s*:?\s*([A-Za-z\s,]+)/i),

      // Contact
      phone: this._extractPhone(text),
      email: this._extractEmail(text),
      presentAddress: this._extract(text, /Present\s*Address\s*:?\s*([^\n]+(?:\n[^\n:]+)*)/i),
      permanentAddress: this._extract(text, /Permanent\s*Address\s*:?\s*([^\n]+(?:\n[^\n:]+)*)/i),

      // Visa Info
      visaType: this._extractVisaType(text),
      visaCategory: this._extract(text, /(?:Visa\s*)?Category\s*:?\s*([A-Za-z\s]+)/i),
      purposeOfVisit: this._extract(text, /Purpose\s*(?:of\s*)?Visit\s*:?\s*([A-Za-z\s,]+)/i),
      intendedDateOfArrival: this._extractDate(text, /(?:Intended|Proposed)\s*Date.*?Arrival\s*:?\s*([\d\/\-\.]+)/i),
      durationOfStay: this._extract(text, /Duration\s*(?:of\s*)?Stay\s*:?\s*(\d+\s*[A-Za-z]*)/i),
      numberOfEntries: this._extract(text, /(?:Number|No\.?)\s*of\s*Entries\s*:?\s*([A-Za-z\s\d]+)/i),

      // Reference in India
      referenceInIndia: {
        name: this._extract(text, /Reference.*?India.*?Name\s*:?\s*([A-Za-z\s]+)/i),
        address: this._extract(text, /Reference.*?India.*?Address\s*:?\s*([^\n]+)/i),
        phone: this._extract(text, /Reference.*?India.*?(?:Phone|Mobile)\s*:?\s*([\d\s\+\-]+)/i),
      },

      // Reference in Bangladesh
      referenceInBD: {
        name: this._extract(text, /Reference.*?Bangladesh.*?Name\s*:?\s*([A-Za-z\s]+)/i),
        address: this._extract(text, /Reference.*?Bangladesh.*?Address\s*:?\s*([^\n]+)/i),
        phone: this._extract(text, /Reference.*?Bangladesh.*?(?:Phone|Mobile)\s*:?\s*([\d\s\+\-]+)/i),
      },

      // Application ID
      applicationId: this._extract(text, /Application\s*(?:ID|No\.?|Reference)\s*:?\s*([A-Z0-9\-\/]+)/i),

      rawText: text,
    };

    // Compose full name
    if (extracted.surname && extracted.givenName) {
      extracted.fullName = `${extracted.givenName.trim()} ${extracted.surname.trim()}`;
    }

    // Clean up all string values
    Object.keys(extracted).forEach(key => {
      if (typeof extracted[key] === 'string') {
        extracted[key] = extracted[key].trim().replace(/\s+/g, ' ') || null;
      }
    });

    logger.info(`PDF extracted: ${extracted.fullName} | Passport: ${extracted.passportNumber}`);
    return extracted;
  }

  _extract(text, regex) {
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  _extractDate(text, regex) {
    const raw = this._extract(text, regex);
    if (!raw) return null;
    // Normalize to DD/MM/YYYY
    const parts = raw.split(/[\/\-\.]/);
    if (parts.length === 3) {
      if (parts[2].length === 4) return `${parts[0].padStart(2,'0')}/${parts[1].padStart(2,'0')}/${parts[2]}`;
      if (parts[0].length === 4) return `${parts[2].padStart(2,'0')}/${parts[1].padStart(2,'0')}/${parts[0]}`;
    }
    return raw;
  }

  _extractPhone(text) {
    const match = text.match(/(?:Mobile|Phone|Contact)\s*:?\s*(01[3-9]\d{8})/i);
    return match ? match[1] : null;
  }

  _extractEmail(text) {
    const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    return match ? match[0] : null;
  }

  _extractGender(text) {
    if (/\b(male|M)\b/i.test(text) && !/female/i.test(text)) return 'Male';
    if (/\bfemale\b/i.test(text)) return 'Female';
    if (/gender\s*:?\s*(male)/i.test(text)) return 'Male';
    if (/gender\s*:?\s*(female)/i.test(text)) return 'Female';
    return null;
  }

  _extractMaritalStatus(text) {
    if (/\bmarried\b/i.test(text)) return 'Married';
    if (/\bsingle\b|\bunmarried\b/i.test(text)) return 'Single';
    if (/\bdivorced\b/i.test(text)) return 'Divorced';
    if (/\bwidow/i.test(text)) return 'Widowed';
    return null;
  }

  _extractVisaType(text) {
    const types = ['Tourist', 'Medical', 'Business', 'Student', 'Employment',
      'Conference', 'Research', 'Transit', 'Entry', 'Visit'];
    for (const t of types) {
      if (new RegExp(`\\b${t}\\b`, 'i').test(text)) return t;
    }
    return null;
  }
}

module.exports = new PdfExtractor();
