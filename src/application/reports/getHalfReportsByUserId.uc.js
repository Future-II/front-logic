const HalfReport = require('../../infrastructure/models/halfReport.model');

const getHalfReportsByUserIdUC = async (userId, page = 1, limit = 10) => {
  try {
    const skip = (page - 1) * limit;
    
    // Get total count
    const totalCount = await HalfReport.countDocuments({ user_id: userId });
    
    // Get paginated reports sorted by newest first
    const reports = await HalfReport.find({ user_id: userId })
      .sort({ _id: -1 }) // Sort by _id descending (newest first)
      .skip(skip)
      .limit(limit)
      .lean();
    
    console.log('Fetched reports:', reports.length, 'Total:', totalCount);
    
    return {
      assets: reports, // Keep as "assets" to match frontend expectation
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPrevPage: page > 1
      }
    };
  } catch (error) {
    console.error('Error in getHalfReportsByUserIdUC:', error);
    throw new Error(error.message);
  }
};

module.exports = {
  getHalfReportsByUserIdUC,
};