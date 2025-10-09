const User = require('../../infrastructure/models/user.model');
const Company = require('../../infrastructure/models/company.model');
const jwt = require('jsonwebtoken');

class CreateUserUseCase {
  async execute(userData) {
    try {
      // Validate required fields
      const requiredFields = [
        'firstName', 'email',
        'password', 'termsAccepted', 'type'
      ];

      // Add lastName to required fields only for individual users
      if (userData.type === 'individual') {
        requiredFields.push('lastName');
      }

      for (const field of requiredFields) {
        if (!userData[field]) {
          throw new Error(`${field} is required`);
        }
      }

      // Validate type
      if (!['company', 'individual'].includes(userData.type)) {
        throw new Error('Invalid user type');
      }

      // Validate role if provided
      if (userData.role && !['manager', 'valuater', 'data entry', 'inspector'].includes(userData.role)) {
        throw new Error('Invalid user role');
      }

      // Check if terms are accepted
      if (!userData.termsAccepted) {
        throw new Error('You must accept the terms and conditions');
      }

      // Check if user already exists
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Create new user
      const user = new User({
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        phone: userData.phone,
        password: userData.password,
        type: userData.type,
        role: userData.role || 'manager', // Default role is manager for both company and individual
        company: userData.company || null, // Set company if provided
        newsletter: userData.newsletter || false,
        termsAccepted: userData.termsAccepted
      });

      await user.save();

      let company = null;

      // If company type and no company provided, this is for registration flow
      // If company is provided, it's already linked (admin creating user for existing company)
      if (userData.type === 'company' && !userData.company) {
        // Validate company fields
        const companyRequiredFields = ['companyName', 'companyType', 'licenseNumber', 'city'];
        for (const field of companyRequiredFields) {
          if (!userData[field]) {
            throw new Error(`${field} is required for company registration`);
          }
        }

        // Check if company name already exists
        const existingCompany = await Company.findOne({ companyName: userData.companyName });
        if (existingCompany) {
          // Company already exists, delete the created user to avoid orphaned record
          await User.findByIdAndDelete(user._id);
          throw new Error('Company with this name already exists');
        }

        // Check if license number already exists
        const existingLicense = await Company.findOne({ licenseNumber: userData.licenseNumber });
        if (existingLicense) {
          // License already exists, delete the created user to avoid orphaned record
          await User.findByIdAndDelete(user._id);
          throw new Error('Company with this license number already exists');
        }

        // Create company
        company = new Company({
          companyName: userData.companyName,
          companyType: userData.companyType,
          licenseNumber: userData.licenseNumber,
          city: userData.city,
          createdBy: user._id,
          users: [user._id]
        });

        await company.save();

        // Update user with company reference
        user.company = company._id;
        await user.save();
      }

      // Generate JWT token
      const secret = process.env.JWT_SECRET || 'default_jwt_secret_for_app';
      const token = jwt.sign(
        {
          userId: user._id,
          email: user.email
        },
        secret,
        { expiresIn: '7d' }
      );

      return {
        success: true,
        message: 'Account created successfully',
        user,
        token
      };

    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }
}

module.exports = new CreateUserUseCase();