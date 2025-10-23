const ExcelData = require("../../infrastructure/models/excelData.model");
const ExcelJS = require('exceljs/dist/es5');
const fs = require('fs');
const path = require('path');

const createExcelData = async (excelFilePath) => {
    try {
        if (!excelFilePath) {
            throw new Error('Excel file path is required');
        }

        console.log(`Reading Excel file from: ${excelFilePath}`);
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(excelFilePath);
        
        console.log(`Number of sheets: ${workbook.worksheets.length}`);
        workbook.worksheets.forEach((sheet, index) => {
            console.log(`Sheet ${index}: ${sheet.name} (${sheet.rowCount} rows)`);
        });

        const baseSheet = workbook.worksheets[0];
        const marketSheet = workbook.worksheets[1];
        const costSheet = workbook.worksheets[2];

        if (!baseSheet) {
            throw new Error('No sheets found in the Excel file');
        }

        // DEBUG: Print all cells in the first few rows to see actual data
        console.log('=== DEBUG: Base Sheet Content ===');
        for (let rowNum = 1; rowNum <= Math.min(10, baseSheet.rowCount); rowNum++) {
            const row = baseSheet.getRow(rowNum);
            const rowData = [];
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                rowData.push(`[${colNumber}]: "${cell.value}"`);
            });
            console.log(`Row ${rowNum}: ${rowData.join(' | ')}`);
        }

        // Extract data under the headings "title" and "value" - VALUES ARE IN NEXT ROW
        let title = '';
        let value = '';
        let titleColumn = null;
        let valueColumn = null;

        // First pass: Find which columns have "title" and "value" headings
        baseSheet.eachRow((row, rowNumber) => {
            row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                const cellValue = String(cell.value).trim().toLowerCase();
                
                if (cellValue === 'title') {
                    titleColumn = colNumber;
                    console.log(`Found "title" heading at row ${rowNumber}, column ${colNumber}`);
                }
                
                if (cellValue === 'value') {
                    valueColumn = colNumber;
                    console.log(`Found "value" heading at row ${rowNumber}, column ${colNumber}`);
                }
            });
        });

        // Second pass: Get the values from the NEXT ROW in the same columns
        if (titleColumn || valueColumn) {
            baseSheet.eachRow((row, rowNumber) => {
                // Look for the row immediately after the headings
                if (rowNumber > 1) { // Start from row 2 since row 1 has headings
                    if (titleColumn && !title) {
                        const titleCell = row.getCell(titleColumn);
                        if (titleCell && titleCell.value) {
                            title = String(titleCell.value).trim();
                            console.log(`Found title value: "${title}" at row ${rowNumber}, column ${titleColumn}`);
                        }
                    }
                    
                    if (valueColumn && !value) {
                        const valueCell = row.getCell(valueColumn);
                        if (valueCell && valueCell.value) {
                            value = String(valueCell.value).trim();
                            console.log(`Found value value: "${value}" at row ${rowNumber}, column ${valueColumn}`);
                        }
                    }
                }
            });
        }

        if (!title) {
            throw new Error('Title not found in the Excel file. Please ensure "title" heading exists and has a value in the next row.');
        }

        if (!value) {
            throw new Error('Value not found in the Excel file. Please ensure "value" heading exists and has a value in the next row.');
        }

        // Count the number of assets from marketSheet and costSheet
        const marketAssetCount = marketSheet ? marketSheet.rowCount - 1 : 0; // Exclude header row
        const costAssetCount = costSheet ? costSheet.rowCount - 1 : 0; // Exclude header row

        console.log(`Asset counts - Market: ${marketAssetCount}, Cost: ${costAssetCount}, Total: ${marketAssetCount + costAssetCount}`);

        const excelData = new ExcelData({
            title: title,
            value: value,
            market_count: marketAssetCount,
            cost_count: costAssetCount,
            excel_file: {
                data: fs.readFileSync(excelFilePath),
                contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                originalName: path.basename(excelFilePath)
            }
        });

        const savedData = await excelData.save();
        console.log('Excel data saved successfully with ID:', savedData._id);
        return savedData;
    } catch (error) {
        console.error("Error in createExcelData:", error);
        throw new Error(error.message || 'Failed to create Excel data');
    }
}

module.exports = createExcelData;