const HalfReport = require("../../infrastructure/models/halfReport.model")

const deleteHalfReportUC = async (halfReportId) => {
    try {
        // Option 1: Find and delete in one operation (recommended)
        const deletedHalfReport = await HalfReport.findByIdAndDelete(halfReportId);
        
        if (!deletedHalfReport) {
            throw new Error('Half report not found');
        }
        
        return deletedHalfReport;
        
    } catch (error) {
        console.error('Error deleting half report:', error);
        throw error;
    }
};


module.exports = { deleteHalfReportUC };