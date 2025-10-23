const mongoose = require("mongoose");

const excelDataSchema = new mongoose.Schema({
    user_id: { type: String },
    title: { type: String },
    market_count: { type: Number, default: 0 },
    cost_count: { type: Number, default: 0 },
    value: { type: String },
    checked: { type: Boolean, default: false },
    excel_file: {
        data: Buffer, 
        contentType: String 
    },
}, { timestamps: true
});

module.exports = mongoose.model("ExcelData", excelDataSchema);