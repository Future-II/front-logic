const halfReportRepository = require('../../infrastructure/repos/halfreport.repo');
const AppError = require('../../shared/utils/appError');

class GetHalfReportByIdUC {
  async execute(id, options = {}) {
    try {
      // Input validation
      if (!id) {
        throw new AppError('Report ID is required', 400);
      }

      const defaultOptions = {
        includeAssets: true,
        assetFields: [], // empty array means all fields
        checkOwnership: false,
        userId: null,
        ...options
      };

      let report;

      // Check ownership if required
      if (defaultOptions.checkOwnership && defaultOptions.userId) {
        report = await halfReportRepository.findByIdForUser(id, defaultOptions.userId);
      } else {
        // Get report with asset data filtering
        if (defaultOptions.includeAssets) {
          report = await halfReportRepository.findByIdWithAssets(id, defaultOptions.assetFields);
        } else {
          report = await halfReportRepository.findById(id);
        }
      }

      // Transform the response if needed
      const transformedReport = this.transformReport(report, defaultOptions);

      return {
        success: true,
        data: transformedReport,
        message: 'HalfReport retrieved successfully'
      };
    } catch (error) {
      console.error(`[GetHalfReportByIdUC] Error executing for ID ${id}:`, error);
      
      if (error.message.includes('not found') || error.message.includes('Invalid report ID')) {
        throw new AppError(error.message, 404);
      } else if (error.message.includes('access denied')) {
        throw new AppError('Access denied to this report', 403);
      }
      
      throw new AppError(`Failed to retrieve report: ${error.message}`, 500);
    }
  }

  transformReport(report, options) {
    // Convert Mongoose document to plain object if needed
    const reportObj = report.toObject ? report.toObject() : report;

    // Remove sensitive fields if needed
    const sensitiveFields = ['__v', 'createdAt', 'updatedAt'];
    sensitiveFields.forEach(field => delete reportObj[field]);

    // Format dates if needed
    if (reportObj.valued_at) {
      reportObj.valued_at = this.formatDate(reportObj.valued_at);
    }
    if (reportObj.submitted_at) {
      reportObj.submitted_at = this.formatDate(reportObj.submitted_at);
    }

    // Calculate total valuer contribution if valuers exist
    if (reportObj.valuers && reportObj.valuers.length > 0) {
      reportObj.total_contribution = reportObj.valuers.reduce(
        (sum, valuer) => sum + (valuer.contribution_percentage || 0), 0
      );
    }

    // Add asset statistics
    if (reportObj.asset_data && Array.isArray(reportObj.asset_data)) {
      reportObj.asset_statistics = {
        total_assets: reportObj.asset_data.length,
        submitted_assets: reportObj.asset_data.filter(asset => asset.submitState === 1).length,
        pending_assets: reportObj.asset_data.filter(asset => asset.submitState === 0).length,
        total_value: reportObj.asset_data.reduce((sum, asset) => {
          return sum + (parseFloat(asset.final_value) || 0);
        }, 0)
      };
    }

    return reportObj;
  }

  formatDate(dateString) {
    try {
      if (!dateString) return null;
      
      // Handle various date formats from Excel/imports
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? dateString : date.toISOString().split('T')[0];
    } catch (error) {
      return dateString;
    }
  }

  // Additional method to get minimal report info (for lists)
  async getReportSummary(id) {
    try {
      const report = await halfReportRepository.findById(id, {
        select: 'title purpose_id value_premise_id valued_at submitted_at asset_data'
      });

      return {
        success: true,
        data: {
          id: report._id,
          title: report.title,
          purpose_id: report.purpose_id,
          value_premise_id: report.value_premise_id,
          valued_at: report.valued_at,
          submitted_at: report.submitted_at,
          asset_count: report.asset_data ? report.asset_data.length : 0
        },
        message: 'Report summary retrieved successfully'
      };
    } catch (error) {
      console.error(`[GetHalfReportByIdUC] Error getting summary for ID ${id}:`, error);
      throw new AppError(`Failed to retrieve report summary: ${error.message}`, 500);
    }
  }
}

module.exports = new GetHalfReportByIdUC();