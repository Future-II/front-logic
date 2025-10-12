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

const noBaseDataExtraction = async (excelFilePath, reportId, userId) => {
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(excelFilePath);
        const sheets = workbook.worksheets;

        if (sheets.length < 2) throw new Error("Expected 2 sheets: marketAssets, costAssets");

        const parseAssetSheet = (sheet, isMarket) => {
            const rows = [];
            const headerRow = sheet.getRow(1);
            const headers = headerRow.values.slice(1).map(h => String(h).trim().toLowerCase());

            for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
                const row = sheet.getRow(rowNum);
                if (row.actualCellCount === 0) continue;

                const asset = {};
                headers.forEach((header, idx) => {
                    const value = row.getCell(idx + 1).value;
                    // Use isNumericField parameter for final_value and other numeric fields
                    const isNumericField = [
                        'final_value', 'market_approach_value', 'cost_approach_value',
                        'value', 'amount', 'price', 'quantity'
                    ].includes(header);
                    
                    asset[header] = getCellValue({ value }, isNumericField);
                });

                if (isMarket) {
                    asset.market_approach_value = asset.final_value || "0";
                    asset.market_approach = "1";
                } else {
                    asset.cost_approach_value = asset.final_value || "0";
                    asset.cost_approach = "1";
                }

                rows.push(asset);
            }
            return rows;
        };

        const marketAssetsSheet = sheets[0];
        const marketAssets = parseAssetSheet(marketAssetsSheet, true);

        const costAssetsSheet = sheets[1];
        const costAssets = parseAssetSheet(costAssetsSheet, false);

        const allAssets = [...marketAssets, ...costAssets];

        const halfReportDoc = new HalfReport({
            report_id: reportId,
            user_id: userId,
            report_asset_file: null,
            asset_data: allAssets
        });

        const saved = await halfReportDoc.save();

        try { 
            if (fs.existsSync(excelFilePath)) fs.unlinkSync(excelFilePath); 
        } catch { }

        return { status: "SUCCESS", data: saved };

    } catch (err) {
        console.error("[noBaseDataExtraction] error:", err);
        return { status: "FAILED", error: err.message };
    }
};

module.exports = { noBaseDataExtraction };