const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  client_name: { type: String, required: true },
  telephone: { type: String, required: true },
  email: { type: String, required: true },
});

const valuerSchema = new mongoose.Schema({
  valuer_name: { type: String, required: true },
  contribution_percentage: { type: Number, required: true }, // percentage
});

const halfReportSchema = new mongoose.Schema({
  user_id: { type: String },
  report_id: { type: String },
  title: { type: String },
  purpose_id: { type: String },
  value_premise_id: { type: String },
  report_type: { type: String },
  valued_at: { type: String },
  submitted_at: { type: String },
  assumptions: { type: String },
  special_assumptions: { type: String },
  value: { type: String },
  valuation_currency: { type: String },
  

  report_asset_file: { type: String },
  client_name: { type: String },

  telephone: { type: String },
  email: { type: String },
  has_other_users: { type: Boolean, default: false },
  report_users: { type: [String], default: [] },
  valuers: { type: [valuerSchema] },

  startSubmitTime: { type: Date },
  endSubmitTime: { type: Date },

  checked: {type: Boolean, default: false},

  asset_data: [{
    id: { type: String },
    serial_no: { type: String },
    asset_type: { type: String, default: "0" },
    asset_name: { type: String },
    inspection_date: { type: String },

    model: { type: String },
    owner_name: { type: String },
    submitState: { type: Number, default: 0 },
    year_made: { type: String },
    final_value: { type: String },
    asset_usage_id: { type: String },
    value_base: { type: String },
    inspection_date: { type: String },
    production_capacity: { type: String, default: "0" },
    production_capacity_measuring_unit: { type: String, default: "0" },
    owner_name: { type: String },
    product_type: { type: String, default: "0" },
    market_approach: { type: String },
    market_approach_value: { type: String },
    cost_approach: { type: String },
    cost_approach_value: { type: String },

    country: { type: String, default: "المملكة العربية السعودية" },
    region: { type: String },
    city: { type: String },

  }],
}, { timestamps: true });

const HalfReport = mongoose.model('HalfReport', halfReportSchema);
module.exports = HalfReport;
