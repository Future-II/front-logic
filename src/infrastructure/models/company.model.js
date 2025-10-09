const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  companyType: {
    type: String,
    required: true,
    enum: ['real-estate', 'construction', 'property-management'],
    default: 'real-estate'
  },
  licenseNumber: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  city: {
    type: String,
    required: true,
    enum: ['riyadh', 'jeddah', 'dammam', 'mecca', 'medina']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  users: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Company', companySchema);
