// src/api/models/application.js
const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  token: String,
  date: String,
  time: String,
  centre: String,
  confirmationNumber: String,
}, { _id: false });

const logEntrySchema = new mongoose.Schema({
  status: String,
  message: String,
  timestamp: { type: Date, default: Date.now },
  error: String,
  appointment: appointmentSchema,
  paymentUrl: String,
  reason: String,
}, { _id: false });

const attendeeSchema = new mongoose.Schema({
  name: String,
  passport: String,
  relation: String,
  bgdPdfPath: String,
}, { _id: false });

const applicationSchema = new mongoose.Schema({
  pipelineId: { type: String, index: true },
  agentId: { type: String, index: true },

  // Applicant Info
  applicantName: String,
  passportNumber: { type: String, index: true },
  phone: String,
  email: String,

  // Booking Details
  ivacLocation: { type: String, required: true },
  visaType: { type: String, required: true },
  preferredDates: [String],
  attendees: [attendeeSchema],

  // Files
  bgdPdfPath: String,
  photoPath: String,
  filesUploaded: { type: Boolean, default: false },

  // Status
  status: {
    type: String,
    enum: [
      'PENDING', 'PROCESSING', 'EXTRACTING_PDF', 'REGISTERING',
      'LOGGING_IN', 'UPLOADING_FILES', 'MONITORING_SLOTS',
      'SLOT_BOOKED', 'SLOT_NOT_FOUND', 'PROCESSING_PAYMENT',
      'PAYMENT_PENDING', 'AWAITING_PAYMENT', 'COMPLETED', 'FAILED', 'STOPPED',
    ],
    default: 'PENDING',
    index: true,
  },

  // Registration
  ivacRegistered: { type: Boolean, default: false },
  ivacSessionState: Object, // Saved browser state

  // Appointment
  appointment: appointmentSchema,

  // Payment
  paymentMode: { type: String, enum: ['self', 'manual'], default: 'self' },
  paymentStatus: { type: String, enum: ['PENDING', 'PAID', 'FAILED'], default: 'PENDING' },
  paymentAmount: { type: Number, default: 1500 },

  // Monitoring
  slotCheckAttempts: { type: Number, default: 0 },
  monitorStartedAt: Date,

  // Logs
  logs: [logEntrySchema],

  // Timestamps
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: Date,
});

applicationSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Virtual: elapsed time in monitoring
applicationSchema.virtual('monitorDuration').get(function () {
  if (!this.monitorStartedAt) return null;
  return Date.now() - this.monitorStartedAt.getTime();
});

module.exports = mongoose.model('Application', applicationSchema);
