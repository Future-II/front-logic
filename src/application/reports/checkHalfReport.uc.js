// In your backend file (where checkHalfReport is defined)
const HalfReport = require('../../infrastructure/models/halfReport.model');

const checkHalfReport = async (id) => {
  try {
    // Single database operation - find and update atomically
    const updated = await HalfReport.findByIdAndUpdate(
      id,
      [
        {
          $set: {
            checked: { $not: "$checked" } // Toggle using MongoDB aggregation
          }
        }
      ],
      { 
        new: true, // Return updated document
        lean: true // Return plain JS object for better performance
      }
    );

    if (!updated) {
      throw new Error('Report not found');
    }

    console.log("Updated report checked status:", updated.checked);
    return updated;
    
  } catch (error) {
    console.error("Error in checkHalfReport:", error);
    throw new Error(error.message || 'Failed to update check status');
  }
};

module.exports = { checkHalfReport };