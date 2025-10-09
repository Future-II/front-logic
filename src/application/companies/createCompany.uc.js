const companyRepo = require('../../infrastructure/repos/company.repo');
const userRepo = require('../../infrastructure/repos/user.repo');

class CreateCompanyUseCase {
  async execute(companyData) {
    try {
      // Validate required fields
      const requiredFields = ['companyName', 'companyType', 'licenseNumber', 'city', 'createdBy'];

      for (const field of requiredFields) {
        if (!companyData[field]) {
          throw new Error(`${field} is required`);
        }
      }

      // Check if company name already exists
      const existingCompany = await companyRepo.findAll();
      const nameExists = existingCompany.some(company => company.companyName === companyData.companyName);
      if (nameExists) {
        throw new Error('Company with this name already exists');
      }

      // Check if license number already exists
      const licenseExists = existingCompany.some(company => company.licenseNumber === companyData.licenseNumber);
      if (licenseExists) {
        throw new Error('Company with this license number already exists');
      }

      // Create new company
      const company = await companyRepo.create({
        companyName: companyData.companyName,
        companyType: companyData.companyType,
        licenseNumber: companyData.licenseNumber,
        city: companyData.city,
        createdBy: companyData.createdBy,
        users: [] // Will add users after company creation
      });

      return {
        success: true,
        message: 'Company created successfully',
        company
      };

    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }
}

module.exports = new CreateCompanyUseCase();
