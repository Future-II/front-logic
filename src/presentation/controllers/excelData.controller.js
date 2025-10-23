const ExcelData = require("../../infrastructure/models/excelData.model");
const createExcelData = require("../../application/excel/createExcelData.uc");
const fs = require('fs');
const path = require('path');

const excelDataController = {
    /**
     * Upload and process Excel file using existing multer config
     */
    uploadExcel: async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No Excel file uploaded. Please select a file.'
                });
            }

            // Validate file type
            const allowedMimeTypes = [
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-excel'
            ];

            if (!allowedMimeTypes.includes(req.file.mimetype)) {
                // Clean up the uploaded file
                fs.unlinkSync(req.file.path);
                return res.status(400).json({
                    success: false,
                    message: 'Invalid file type. Please upload an Excel file (.xlsx, .xls)'
                });
            }

            // Use your existing createExcelData function
            const savedData = await createExcelData(req.file.path);

            // Clean up the uploaded file after processing
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            res.status(201).json({
                success: true,
                message: 'Excel file processed and saved successfully',
                data: {
                    id: savedData._id,
                    title: savedData.title,
                    value: savedData.value,
                    market_count: savedData.market_count,
                    cost_count: savedData.cost_count,
                    created_at: savedData.createdAt
                }
            });

        } catch (error) {
            console.error("Upload Excel Error:", error);

            // Clean up uploaded file if it exists
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            res.status(500).json({
                success: false,
                message: error.message || 'Failed to process Excel file'
            });
        }
    },

    /**
     * Get all Excel data records (without file buffers for listing)
     */

    /**
 * Toggle/invert the checked value for a record
 */
    toggleChecked: async (req, res) => {
        try {
            const record = await ExcelData.findById(req.params.id);

            if (!record) {
                return res.status(404).json({
                    success: false,
                    message: 'Record not found'
                });
            }

            // Invert the checked value
            record.checked = !record.checked;
            const updatedRecord = await record.save();

            res.json({
                success: true,
                message: `Checked status ${updatedRecord.checked ? 'checked' : 'unchecked'} successfully`,
                data: {
                    id: updatedRecord._id,
                    checked: updatedRecord.checked,
                    title: updatedRecord.title
                }
            });

        } catch (error) {
            console.error("Toggle Checked Error:", error);

            if (error.name === 'CastError') {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid record ID format'
                });
            }

            res.status(500).json({
                success: false,
                message: 'Failed to toggle checked status'
            });
        }
    },

    getAllExcelData: async (req, res) => {
        try {
            const { page = 1, limit = 10, sort = '-createdAt' } = req.query;

            const records = await ExcelData.find({})
                .select('-excel_file.data') // Exclude the large file buffer
                .sort(sort)
                .limit(limit * 1)
                .skip((page - 1) * limit);

            const total = await ExcelData.countDocuments();

            res.json({
                success: true,
                data: records,
                pagination: {
                    current: parseInt(page),
                    pages: Math.ceil(total / limit),
                    total: total
                }
            });

        } catch (error) {
            console.error("Get All Excel Data Error:", error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch Excel data records'
            });
        }
    },

    /**
     * Get single Excel data record by ID
     */
    getExcelDataById: async (req, res) => {
        try {
            const record = await ExcelData.findById(req.params.id)
                .select('-excel_file.data'); // Exclude file buffer for detail view

            if (!record) {
                return res.status(404).json({
                    success: false,
                    message: 'Excel data record not found'
                });
            }

            res.json({
                success: true,
                data: record
            });

        } catch (error) {
            console.error("Get Excel Data By ID Error:", error);

            if (error.name === 'CastError') {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid record ID format'
                });
            }

            res.status(500).json({
                success: false,
                message: 'Failed to fetch Excel data record'
            });
        }
    },

    /**
     * Download the original Excel file
     */
    /**
 * Download the original Excel file
 */
downloadExcelFile: async (req, res) => {
    try {
        const record = await ExcelData.findById(req.params.id);

        if (!record) {
            return res.status(404).json({
                success: false,
                message: 'Record not found'
            });
        }

        if (!record.excel_file || !record.excel_file.data) {
            return res.status(404).json({
                success: false,
                message: 'Excel file not found for this record'
            });
        }

        // Handle Arabic filename properly
        let filename = record.title || 'download';
        
        // Sanitize Arabic filename and ensure proper encoding
        const sanitizeArabicFilename = (name) => {
            // Remove any characters that might cause issues
            return name.replace(/[<>:"/\\|?*]/g, '_');
        };

        filename = sanitizeArabicFilename(filename) + '.xlsx';

        // Encode the filename for proper handling of Arabic characters
        const encodedFilename = encodeURIComponent(filename);
        
        // Set headers with proper encoding for Arabic characters
        res.set({
            'Content-Type': record.excel_file.contentType,
            'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
            'Content-Length': record.excel_file.data.length,
            'Cache-Control': 'no-cache'
        });

        // Send the file buffer
        res.send(record.excel_file.data);

    } catch (error) {
        console.error("Download Excel File Error:", error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid record ID format'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to download Excel file'
        });
    }
},

    /**
     * Delete Excel data record
     */
    deleteExcelData: async (req, res) => {
        try {
            const record = await ExcelData.findByIdAndDelete(req.params.id);

            if (!record) {
                return res.status(404).json({
                    success: false,
                    message: 'Record not found'
                });
            }

            res.json({
                success: true,
                message: 'Excel data record deleted successfully',
                deletedId: record._id
            });

        } catch (error) {
            console.error("Delete Excel Data Error:", error);

            if (error.name === 'CastError') {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid record ID format'
                });
            }

            res.status(500).json({
                success: false,
                message: 'Failed to delete Excel data record'
            });
        }
    },

    /**
     * Get extracted data summary (without the file)
     */
    getDataSummary: async (req, res) => {
        try {
            const records = await ExcelData.find({})
                .select('title value asset_count createdAt')
                .sort({ createdAt: -1 });

            // Calculate some summary statistics
            const totalAssets = records.reduce((sum, record) => sum + (record.asset_count || 0), 0);
            const totalRecords = records.length;

            res.json({
                success: true,
                data: records,
                summary: {
                    total_records: totalRecords,
                    total_assets: totalAssets,
                    average_assets: totalRecords > 0 ? Math.round(totalAssets / totalRecords) : 0
                }
            });

        } catch (error) {
            console.error("Get Data Summary Error:", error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch data summary'
            });
        }
    }
};

module.exports = excelDataController;