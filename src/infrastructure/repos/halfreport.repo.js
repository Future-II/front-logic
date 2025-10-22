const HalfReport = require('../models/halfReport.model');

class HalfReportRepository {
  async findById(id, options = {}) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error('Invalid report ID format');
      }

      const query = HalfReport.findById(id);
      
      // Populate related data if needed
      if (options.populate) {
        query.populate(options.populate);
      }
      
      // Select specific fields if specified
      if (options.select) {
        query.select(options.select);
      }
      
      const report = await query.exec();
      
      if (!report) {
        throw new Error('HalfReport not found');
      }
      
      return report;
    } catch (error) {
      console.error(`[HalfReportRepository] Error finding report by ID ${id}:`, error);
      throw error;
    }
  }

  async findByIdWithAssets(id, assetFields = []) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error('Invalid report ID format');
      }

      const report = await HalfReport.findById(id)
        .select('+asset_data') // Ensure asset_data is included
        .lean(); // Return plain JavaScript object for better performance

      if (!report) {
        throw new Error('HalfReport not found');
      }

      // Filter asset fields if specified
      if (assetFields.length > 0 && report.asset_data) {
        report.asset_data = report.asset_data.map(asset => {
          const filteredAsset = {};
          assetFields.forEach(field => {
            if (asset[field] !== undefined) {
              filteredAsset[field] = asset[field];
            }
          });
          return filteredAsset;
        });
      }

      return report;
    } catch (error) {
      console.error(`[HalfReportRepository] Error finding report with assets by ID ${id}:`, error);
      throw error;
    }
  }

  async findByIdForUser(id, userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error('Invalid report ID format');
      }

      const report = await HalfReport.findOne({
        _id: id,
        $or: [
          { user_id: userId },
          { report_users: { $in: [userId] } }
        ]
      });

      if (!report) {
        throw new Error('HalfReport not found or access denied');
      }

      return report;
    } catch (error) {
      console.error(`[HalfReportRepository] Error finding report for user ${userId}:`, error);
      throw error;
    }
  }

  async exists(id) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return false;
      }
      
      const count = await HalfReport.countDocuments({ _id: id });
      return count > 0;
    } catch (error) {
      console.error(`[HalfReportRepository] Error checking report existence ${id}:`, error);
      return false;
    }
  }
}

module.exports = new HalfReportRepository();