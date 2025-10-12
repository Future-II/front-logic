const fs = require('fs');
const ExcelJS = require('exceljs/dist/es5');

const HalfReport = require('../../infrastructure/models/halfReport.model');

const formatDateTime = (value) => {
    if (!value) return '';
    
    if (value instanceof Date) {
        const yyyy = value.getFullYear();
        const mm = String(value.getMonth() + 1).padStart(2, '0');
        const dd = String(value.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    
    if (typeof value === 'number') {
        // Excel date number (days since 1900-01-01)
        const date = new Date((value - 25569) * 86400 * 1000);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    
    if (typeof value === 'string') {
        const dateFormats = [
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/, 
            /(\d{4})-(\d{1,2})-(\d{1,2})/,   
            /(\d{1,2})-(\d{1,2})-(\d{4})/   
        ];
        
        for (const format of dateFormats) {
            const match = value.match(format);
            if (match) {
                let year, month, day;
                
                if (format === dateFormats[0]) {
                    day = match[1].padStart(2, '0');
                    month = match[2].padStart(2, '0');
                    year = match[3];
                } else if (format === dateFormats[1]) {
                    year = match[1];
                    month = match[2].padStart(2, '0');
                    day = match[3].padStart(2, '0');
                } else if (format === dateFormats[2]) {
                    day = match[1].padStart(2, '0');
                    month = match[2].padStart(2, '0');
                    year = match[3];
                }
                
                return `${year}-${month}-${day}`;
            }
        }
    }
    
    return String(value);
};

const getCellValue = (cell, isNumericField = false) => {
    if (!cell) return '';

    const value = cell.value;

    if (value === null || value === undefined) return '';

    if (typeof value === 'object' && value.hasOwnProperty('formula')) {
        return getCellValue({ value: value.result }, isNumericField);
    }

    // For numeric fields like final_value, don't apply date formatting
    if (isNumericField) {
        return String(value);
    }

    // Use formatDateTime for date values (only for non-numeric fields)
    if (value instanceof Date || typeof value === 'number' || 
        (typeof value === 'string' && value.match(/\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}/))) {
        return formatDateTime(value);
    }

    if (typeof value === 'object' && value.hasOwnProperty('text')) {
        return String(value.text);
    }

    return String(value);
};

const formDataExtraction = async (excelFilePath, pdfFilePaths = null, userId, formData) => {
    try {
        if (!formData) {
            throw new Error("Form data is required for this extraction method");
        }

        console.log("Received formData:", typeof formData, formData);

        // Parse the stringified form data back to an object
        let parsedFormData;
        if (typeof formData === 'string') {
            try {
                parsedFormData = JSON.parse(formData);
                console.log("Successfully parsed formData");
            } catch (parseError) {
                console.error("Failed to parse formData:", parseError);
                throw new Error("Invalid formData format - expected JSON string");
            }
        } else {
            // If it's already an object, use it directly
            parsedFormData = formData;
        }

        console.log("Parsed formData:", parsedFormData);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(excelFilePath);
        const sheets = workbook.worksheets;

        if (sheets.length !== 2) {
            throw new Error("With formData, expected exactly 2 sheets: marketAssets and costAssets");
        }

        // Parse form data to get base data and repeated fields - use parsedFormData now
        const { baseData, repeatedFields } = parseFormData(parsedFormData);
        
        // Rest of your function remains the same...
        const marketAssets = parseAssetSheet(sheets[0], true, repeatedFields);
        const costAssets = parseAssetSheet(sheets[1], false, repeatedFields);

        const allAssets = [...marketAssets, ...costAssets];

        const halfReportDoc = new HalfReport({
            ...baseData,
            user_id: userId,
            report_asset_file: pdfFilePaths || null,
            asset_data: allAssets
        });

        const saved = await halfReportDoc.save();

        // Clean up
        try { 
            if (fs.existsSync(excelFilePath)) fs.unlinkSync(excelFilePath); 
        } catch (error) { 
            console.warn("Could not delete temporary Excel file:", error.message);
        }

        return { status: "SUCCESS", data: saved };

    } catch (err) {
        console.error("[formDataExtraction] error:", err);
        
        // Clean up on error
        try { 
            if (fs.existsSync(excelFilePath)) fs.unlinkSync(excelFilePath); 
        } catch (error) { 
            console.warn("Could not delete temporary Excel file on error:", error.message);
        }
        
        return { status: "FAILED", error: err.message };
    }
};

const parseFormData = (formData) => {
    const baseData = {
        title: formData.title || '',
        purpose_id: formData.purpose_id || '',
        value_premise_id: formData.value_premise_id || '',
        report_type: formData.report_type || 'detailed',
        valued_at: formData.valued_at || '',
        submitted_at: formData.submitted_at || '',
        assumptions: formData.assumptions || '',
        special_assumptions: formData.special_assumptions || '',
        value: formData.value || '',
        valuation_currency: formData.valuation_currency || 'Saudi riyal',
        client_name: formData.client_name || '',
        telephone: formData.telephone || '',
        email: formData.email || '',
        owner_name: formData.owner_name || '',
        clients: Array.isArray(formData.clients) ? formData.clients : [],
        has_other_users: formData.has_other_users || false,
        report_users: Array.isArray(formData.report_users) ? formData.report_users : [],
        inspection_date: formData.inspection_date || formData.valued_at || '',
    };

    const repeatedFields = {
        owner_name: baseData.owner_name,
        inspection_date: baseData.inspection_date,
    };

    return { baseData, repeatedFields };
};

const parseAssetSheet = (sheet, isMarket, repeatedFields = {}) => {
    const rows = [];
    
    if (!sheet || sheet.rowCount < 2) {
        return rows;
    }

    const headerRow = sheet.getRow(1);
    const headers = headerRow.values.slice(1).map(h => String(h).trim().toLowerCase());

    for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
        const row = sheet.getRow(rowNum);
        if (row.actualCellCount === 0) continue;

        const asset = {};
        headers.forEach((header, idx) => {
            const cell = row.getCell(idx + 1);
            // Use isNumericField parameter for final_value and other numeric fields
            const isNumericField = [
                'final_value', 'market_approach_value', 'cost_approach_value',
                'value', 'amount', 'price', 'quantity'
            ].includes(header);
            
            asset[header] = getCellValue(cell, isNumericField);
        });

        if (isMarket) {
            asset.market_approach_value = asset.final_value || "0";
            asset.market_approach = "1";
        } else {
            asset.cost_approach_value = asset.final_value || "0";
            asset.cost_approach = "1";
        }

        // Add repeated fields to each asset
        Object.keys(repeatedFields).forEach(field => {
            asset[field] = repeatedFields[field] || '';
        });

        rows.push(asset);
    }
    
    return rows;
};

module.exports = { formDataExtraction };