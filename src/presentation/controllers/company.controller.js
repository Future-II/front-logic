const createCompanyUseCase = require('../../application/companies/createCompany.uc');
const getCompaniesUseCase = require('../../application/companies/getCompanies.uc');
const companyRepo = require('../../infrastructure/repos/company.repo');
const User = require('../../infrastructure/models/user.model');

class CompanyController {
  // Create new company
  async createCompany(req, res) {
    let createdCompany = null;

    try {
      // First, create the company
      const result = await createCompanyUseCase.execute({
        ...req.body,
        createdBy: req.user.userId
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message
        });
      }

      createdCompany = result.company;

      // Check if user data is provided (for combined company + user creation)
      if (req.body.firstName && req.body.lastName && req.body.email && req.body.phone && req.body.password) {
        // Now create the user with the company ID
        const createUserUseCase = require('../../application/users/createUser.uc');
        const userData = {
          firstName: req.body.firstName,
          lastName: req.body.lastName,
          email: req.body.email,
          phone: req.body.phone,
          password: req.body.password,
          type: 'company',
          role: 'manager',
          termsAccepted: req.body.termsAccepted || true,
          company: createdCompany._id, // Link user to the created company
        };

        const userResult = await createUserUseCase.execute(userData);

        if (!userResult.success) {
          // User creation failed, delete the created company to avoid orphaned record
          await companyRepo.delete(createdCompany._id);
          return res.status(400).json({
            success: false,
            message: userResult.message
          });
        }

        // Add the user to the company's users array
        await companyRepo.addUser(createdCompany._id, userResult.user._id);

        res.status(201).json({
          success: true,
          message: result.message,
          company: createdCompany,
          user: userResult.user
        });
      } else {
        // Only company creation
        res.status(201).json({
          success: true,
          message: result.message,
          company: createdCompany
        });
      }

    } catch (error) {
      // If any error occurs and company was created, clean it up
      if (createdCompany) {
        try {
          await companyRepo.delete(createdCompany._id);
        } catch (cleanupError) {
          console.error('Error cleaning up company:', cleanupError);
        }
      }

      console.error('Create company error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get all companies
  async getCompanies(req, res) {
    try {
      const result = await getCompaniesUseCase.execute();

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message
        });
      }

      res.json({
        success: true,
        companies: result.companies
      });

    } catch (error) {
      console.error('Get companies error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get company by id
  async getCompanyById(req, res) {
    try {
      const { id } = req.params;
      const company = await companyRepo.findById(id);

      if (!company) {
        return res.status(404).json({
          success: false,
          message: 'Company not found'
        });
      }

      res.json({
        success: true,
        company
      });

    } catch (error) {
      console.error('Get company by id error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Update company
  async updateCompany(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Check if user is super admin or manager of this company
      const user = await User.findById(req.user.userId);
      const company = await companyRepo.findById(id);
      const isSuperAdmin = user && user.email.toLowerCase() === 'super.admin@gmail.com';
      if (!company || !user || (!isSuperAdmin && (user.role !== 'manager' || user.company.toString() !== id))) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const updatedCompany = await companyRepo.update(id, updates);

      if (!updatedCompany) {
        return res.status(404).json({
          success: false,
          message: 'Company not found'
        });
      }

      res.json({
        success: true,
        message: 'Company updated successfully',
        company: updatedCompany
      });

    } catch (error) {
      console.error('Update company error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get users by company
  async getUsersByCompany(req, res) {
    try {
      const { id } = req.params;

      // Allow super admin or users belonging to this company
      const user = await User.findById(req.user.userId);
      const isSuperAdmin = user && user.email.toLowerCase() === 'super.admin@gmail.com';
      if (!user || (!isSuperAdmin && user.company.toString() !== id)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Fetch users for the company with populated company data
      const users = await User.find({ company: id }).populate('company');

      if (!users) {
        return res.status(404).json({
          success: false,
          message: 'No users found'
        });
      }

      // Format users data for frontend
      const formattedUsers = users.map(user => ({
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        company: user.company ? user.company.companyName : '',
        status: user.isActive ? 'Active' : 'Inactive',
        lastActive: user.updatedAt
      }));

      res.json({
        success: true,
        users: formattedUsers
      });

    } catch (error) {
      console.error('Get users by company error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Add user to company
  async addUserToCompany(req, res) {
    try {
      const { id } = req.params;
      const userData = {
        ...req.body,
        company: id // Link user to the company
      };

      // Check if user is super admin or manager of this company
      const user = await User.findById(req.user.userId);
      const company = await companyRepo.findById(id);
      const isSuperAdmin = user && user.email.toLowerCase() === 'super.admin@gmail.com';
      if (!company || !user || (!isSuperAdmin && (user.role !== 'manager' || user.company.toString() !== id))) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Create user with company reference
      const createUserUseCase = require('../../application/users/createUser.uc');
      const result = await createUserUseCase.execute(userData);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message
        });
      }

      // Add user to company
      const updatedCompany = await companyRepo.addUser(id, result.user._id);

      res.status(201).json({
        success: true,
        message: 'User added to company successfully',
        user: result.user,
        company: updatedCompany
      });

    } catch (error) {
      console.error('Add user to company error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Delete company
  async deleteCompany(req, res) {
    try {
      const { id } = req.params;

      // Check if user is super admin
      const user = await User.findById(req.user.userId);
      if (!user || user.email.toLowerCase() !== 'super.admin@gmail.com') {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const company = await companyRepo.findById(id);
      if (!company) {
        return res.status(404).json({
          success: false,
          message: 'Company not found'
        });
      }

      // Delete all users in the company
      await User.deleteMany({ company: id });

      // Delete the company
      await companyRepo.delete(id);

      res.json({
        success: true,
        message: 'Company and its users deleted successfully'
      });

    } catch (error) {
      console.error('Delete company error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

}

module.exports = new CompanyController();
