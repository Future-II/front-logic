const companyRepo = require('../../infrastructure/repos/company.repo');

class GetCompaniesUseCase {
  async execute() {
    try {
      const companies = await companyRepo.findAll();

      return {
        success: true,
        companies
      };

    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }
}

module.exports = new GetCompaniesUseCase();
