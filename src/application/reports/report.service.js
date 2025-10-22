// front-logic/src/application/reports/report.service.js
const Report = require('../../infrastructure/models/report.model');

class ReportService {
  /**
   * Build filter object for report queries based on new structure
   */
  static buildFilter(queryParams) {
    const { 
      reportTitle, 
      location,
      propertyType,
      propertyUse,
      clientName,
      fromDate, 
      toDate,
      certificateNumber,
      query,
      type = "eval_model_scraped"
    } = queryParams;
    
    const filter = { type }; // Always filter by type
    
    // Client name search
    if (clientName) {
      filter['payload.client_name'] = { $regex: clientName, $options: 'i' };
    }
    
    // Location search
    if (location) {
      filter['payload.location'] = { $regex: location, $options: 'i' };
    }
    
    // Property type filter
    if (propertyType) {
      filter['payload.property_type'] = { $regex: propertyType, $options: 'i' };
    }
    
    // Property use filter
    if (propertyUse) {
      filter['payload.property_use'] = { $regex: propertyUse, $options: 'i' };
    }
    
    // Query field search (report ID)
    if (query) {
      filter['query'] = { $regex: query, $options: 'i' };
    }
    
    // Certificate number search (title deed)
    if (certificateNumber) {
      filter['payload.title_deed_no'] = { $regex: certificateNumber, $options: 'i' };
    }
    
    // Date range filter (using evaluation date)
    if (fromDate || toDate) {
      const dateFilter = {};
      
      if (fromDate) {
        // Convert to regex pattern for date matching
        const fromDateStr = new Date(fromDate).toISOString().split('T')[0];
        dateFilter.$gte = fromDateStr;
      }
      
      if (toDate) {
        const toDateStr = new Date(toDate).toISOString().split('T')[0];
        dateFilter.$lte = toDateStr;
      }
      
      // Use regex for date string matching since dates are stored as strings
      if (fromDate && toDate) {
        // For date range, we need to handle string date comparison
        filter['payload.actual_evaluation_date_m'] = {
          $regex: new RegExp(`(${fromDate.replace(/-/g, '-')}|${toDate.replace(/-/g, '-')})`)
        };
      }
    }

    return filter;
  }

  /**
   * Calculate pagination details
   */
  static calculatePagination(page, limit, totalReports) {
    return {
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalReports / limit),
      totalReports,
      hasNext: page * limit < totalReports,
      hasPrev: page > 1
    };
  }

  /**
   * Parse date string from the new format (DD-MM-YYYY HH:mm)
   */
  static parseDate(dateString) {
    if (!dateString || dateString === '-') return null;
    
    try {
      // Handle format like "11-08-2025 00:00"
      const [datePart, timePart] = dateString.split(' ');
      const [day, month, year] = datePart.split('-');
      return new Date(year, month - 1, day).toISOString().split('T')[0];
    } catch (error) {
      return dateString;
    }
  }

  /**
   * Parse currency value string and convert to number
   */
  static parseValue(valueString) {
    if (!valueString) return 0;
    
    // Remove commas and convert to float
    const numericValue = parseFloat(valueString.replace(/,/g, ''));
    return isNaN(numericValue) ? 0 : numericValue;
  }

  /**
   * Transform report data for API response based on new structure
   */
  static transformReportForResponse(report) {
    if (!report) return null;
    
    const payload = report.payload || {};
    
    return {
      id: report._id,
      query: report.query,
      type: report.type,
      
      // Basic Information
      title: payload.client_name || 'تقرير تقييم عقاري',
      reportType: 'PDF', // Default since not in new structure
      
      // Dates
      valuationDate: this.parseDate(payload.actual_evaluation_date_m),
      inspectionDate: this.parseDate(payload.actual_inspection_date_m),
      submissionDate: report.ts ? new Date(report.ts).toISOString().split('T')[0] : null,
      
      // Values
      finalValue: this.parseValue(payload.final_valuation_value),
      currency: 'SAR', // Default currency
      
      // Client Info
      clientName: payload.client_name,
      
      // Property Info
      propertyType: payload.property_type,
      propertyUse: payload.property_use,
      location: payload.location,
      
      // Property Details
      landArea: payload.land_area ? parseFloat(payload.land_area.replace(/,/g, '')) : 0,
      streetView: payload.street_view,
      planNo: payload.plan_no,
      parcelNo: payload.parcel_no,
      titleDeedNo: payload.title_deed_no,
      
      // Location Coordinates
      coordinates: {
        longitude: payload.longitude ? parseFloat(payload.longitude) : 0,
        latitude: payload.latitude ? parseFloat(payload.latitude) : 0
      },
      
      // Valuation Approaches
      approaches: {
        market: payload.approach_market === 'نعم',
        income: payload.approach_income === 'نعم', 
        cost: payload.approach_cost === 'نعم'
      },
      
      // Estimation Details
      estimationReason: payload.estimation_reason,
      estimationBase: payload.estimation_base,
      ownershipType: payload.ownership_type,
      
      // Offers/Comparables
      offers: payload.offers || [],
      
      // Metadata
      scrapedAt: payload.scraped_at,
      createdAt: report.ts,
      updatedAt: report.ts
    };
  }

  /**
   * Fetch reports with filtering and pagination
   */
  static async getReports(queryParams) {
    const { page = 1, limit = 25 } = queryParams;
    
    const filter = this.buildFilter(queryParams);
    const skip = (page - 1) * limit;
    
    // Fetch reports with pagination
    const reports = await Report.find(filter)
      .sort({ ts: -1 }) // Sort by timestamp descending
      .skip(skip)
      .limit(parseInt(limit))
      .lean(); // Use lean() for better performance
    
    // Transform reports for response
    const transformedReports = reports.map(report => this.transformReportForResponse(report));
    
    // Get total count for pagination
    const totalReports = await Report.countDocuments(filter);
    
    const pagination = this.calculatePagination(page, limit, totalReports);
    
    return {
      reports: transformedReports,
      pagination
    };
  }

  /**
   * Fetch single report by ID
   */
  static async getReportById(id) {
    const report = await Report.findById(id).lean();
    return this.transformReportForResponse(report);
  }

  /**
   * Get report statistics
   */
  static async getReportStats() {
    const stats = await Report.aggregate([
      {
        $match: { type: "eval_model_scraped" }
      },
      {
        $group: {
          _id: null,
          totalReports: { $sum: 1 },
          totalValue: { 
            $sum: { 
              $toDouble: { 
                $replaceAll: { 
                  input: "$payload.final_valuation_value", 
                  find: ",", 
                  replacement: "" 
                } 
              } 
            } 
          },
          averageValue: { 
            $avg: { 
              $toDouble: { 
                $replaceAll: { 
                  input: "$payload.final_valuation_value", 
                  find: ",", 
                  replacement: "" 
                } 
              } 
            } 
          },
          propertyTypes: { $addToSet: "$payload.property_type" },
          propertyUses: { $addToSet: "$payload.property_use" },
          locations: { $addToSet: "$payload.location" },
          clients: { $addToSet: "$payload.client_name" }
        }
      }
    ]);


    // Get additional aggregations for detailed statistics
    const monthlyStats = await Report.aggregate([
      {
        $match: { type: "eval_model_scraped" }
      },
      {
        $group: {
          _id: {
            year: { $year: "$ts" },
            month: { $month: "$ts" }
          },
          count: { $sum: 1 },
          totalValue: { 
            $sum: { 
              $toDouble: { 
                $replaceAll: { 
                  input: "$payload.final_valuation_value", 
                  find: ",", 
                  replacement: "" 
                } 
              } 
            } 
          }
        }
      },
      {
        $sort: { "_id.year": -1, "_id.month": -1 }
      },
      {
        $limit: 12
      }
    ]);
    
    const baseStats = stats[0] || {
      totalReports: 0,
      totalValue: 0,
      averageValue: 0,
      propertyTypes: [],
      propertyUses: [],
      locations: [],
      clients: []
    };

    return {
      ...baseStats,
      monthlyStats: monthlyStats.reverse() // Most recent first
    };
  }

  /**
   * Search reports by multiple criteria
   */
  static async searchReports(searchTerm, filters = {}) {
    const searchFilter = {
      type: "eval_model_scraped",
      $or: [
        { 'payload.client_name': { $regex: searchTerm, $options: 'i' } },
        { 'payload.location': { $regex: searchTerm, $options: 'i' } },
        { 'payload.property_type': { $regex: searchTerm, $options: 'i' } },
        { 'payload.property_use': { $regex: searchTerm, $options: 'i' } },
        { 'payload.title_deed_no': { $regex: searchTerm, $options: 'i' } },
        { 'query': { $regex: searchTerm, $options: 'i' } }
      ]
    };

    // Merge with additional filters
    const additionalFilters = this.buildFilter(filters);
    const finalFilter = { ...searchFilter, ...additionalFilters };

    const reports = await Report.find(finalFilter)
      .sort({ ts: -1 })
      .limit(50)
      .lean();

    return reports.map(report => this.transformReportForResponse(report));
  }

  /**
   * Get unique values for filter dropdowns
   */
  static async getFilterOptions() {
    const options = await Report.aggregate([
      {
        $match: { type: "eval_model_scraped" }
      },
      {
        $group: {
          _id: null,
          propertyTypes: { $addToSet: "$payload.property_type" },
          propertyUses: { $addToSet: "$payload.property_use" },
          locations: { $addToSet: "$payload.location" },
          clients: { $addToSet: "$payload.client_name" }
        }
      }
    ]);

    return options[0] || {
      propertyTypes: [],
      propertyUses: [],
      locations: [],
      clients: []
    };
  }

  /**
   * Get reports summary by various groupings
   */
  static async getReportsSummary(groupBy = 'propertyType') {
    let groupField;
    switch (groupBy) {
      case 'propertyType':
        groupField = '$payload.property_type';
        break;
      case 'propertyUse':
        groupField = '$payload.property_use';
        break;
      case 'location':
        groupField = '$payload.location';
        break;
      case 'client':
        groupField = '$payload.client_name';
        break;
      default:
        groupField = '$payload.property_type';
    }

    const summary = await Report.aggregate([
      {
        $match: { type: "eval_model_scraped" }
      },
      {
        $group: {
          _id: groupField,
          count: { $sum: 1 },
          totalValue: { 
            $sum: { 
              $toDouble: { 
                $replaceAll: { 
                  input: "$payload.final_valuation_value", 
                  find: ",", 
                  replacement: "" 
                } 
              } 
            } 
          },
          averageValue: { 
            $avg: { 
              $toDouble: { 
                $replaceAll: { 
                  input: "$payload.final_valuation_value", 
                  find: ",", 
                  replacement: "" 
                } 
              } 
            } 
          },
          averageLandArea: {
            $avg: {
              $toDouble: {
                $replaceAll: {
                  input: "$payload.land_area",
                  find: ",",
                  replacement: ""
                }
              }
            }
          }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    return {
      groupBy,
      summary: summary.map(item => ({
        category: item._id || 'Unknown',
        count: item.count,
        totalValue: Math.round(item.totalValue || 0),
        averageValue: Math.round(item.averageValue || 0),
        averageLandArea: Math.round(item.averageLandArea || 0)
      }))
    };
  }

  /**
   * Convert reports to CSV format
   */
  static convertToCSV(reports) {
    if (!reports || reports.length === 0) {
      return 'No data available';
    }

    // Define CSV headers
    const headers = [
      'ID',
      'Query',
      'Client Name',
      'Property Type',
      'Property Use',
      'Location',
      'Final Value (SAR)',
      'Land Area',
      'Title Deed No',
      'Evaluation Date',
      'Inspection Date',
      'Coordinates',
      'Estimation Reason',
      'Estimation Base',
      'Market Approach',
      'Income Approach',
      'Cost Approach'
    ];

    // Convert reports to CSV rows
    const csvRows = [
      headers.join(','), // Header row
      ...reports.map(report => [
        report.id || '',
        report.query || '',
        `"${(report.clientName || '').replace(/"/g, '""')}"`,
        `"${(report.propertyType || '').replace(/"/g, '""')}"`,
        `"${(report.propertyUse || '').replace(/"/g, '""')}"`,
        `"${(report.location || '').replace(/"/g, '""')}"`,
        report.finalValue || 0,
        report.landArea || 0,
        report.titleDeedNo || '',
        report.valuationDate || '',
        report.inspectionDate || '',
        `"${report.coordinates?.latitude || 0},${report.coordinates?.longitude || 0}"`,
        `"${(report.estimationReason || '').replace(/"/g, '""')}"`,
        `"${(report.estimationBase || '').replace(/"/g, '""')}"`,
        report.approaches?.market ? 'Yes' : 'No',
        report.approaches?.income ? 'Yes' : 'No',
        report.approaches?.cost ? 'Yes' : 'No'
      ].join(','))
    ];

    return csvRows.join('\n');
  }
}

module.exports = ReportService;