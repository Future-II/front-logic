const User = require('../../infrastructure/models/user.model');
const createUserUseCase = require('../../application/users/createUser.uc');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Company = require('../../infrastructure/models/company.model');

class UserController {
  // Register new user
  async register(req, res) {
    try {
      const result = await createUserUseCase.execute(req.body);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message
        });
      }

      // Check if user needs company setup
      const needsCompanySetup = false; // Company setup handled during registration
      const isManager = result.user.role === 'manager';

      res.status(201).json({
        success: true,
        message: result.message,
        user: result.user,
        token: result.token,
        needsCompanySetup,
        isManager
      });

    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Login user
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
      }

      // Find user
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Check if account is active
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated'
        });
      }

      // Generate token
      const secret = process.env.JWT_SECRET || 'default_jwt_secret_for_app';
      const token = jwt.sign(
        {
          userId: user._id,
          email: user.email
        },
        secret,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        message: 'Login successful',
        user,
        token
      });

    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get current user profile
  async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.userId).populate('company');
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      // Debug: طباعة بيانات المستخدم قبل الإرسال
      console.log('USER PROFILE DATA:', user);
      // تحويل المستخدم إلى كائن عادي وإزالة كلمة المرور فقط
      const userObj = user.toObject();
      delete userObj.password;
      // إضافة القيم الافتراضية للحقول إذا كانت غير موجودة
      userObj.firstName = userObj.firstName || "";
      userObj.lastName = userObj.lastName || "";
      userObj.email = userObj.email || "";
      userObj.phone = userObj.phone || "";
      // Populate company fields if company exists
      if (userObj.company) {
        userObj.companyName = userObj.company.companyName || "";
        userObj.companyType = userObj.company.companyType || "";
        userObj.licenseNumber = userObj.company.licenseNumber || "";
        userObj.city = userObj.company.city || "";
      } else {
        userObj.companyName = "";
        userObj.companyType = "";
        userObj.licenseNumber = "";
        userObj.city = "";
      }
      res.json({
        success: true,
        user: userObj
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Verify token
  async verifyToken(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        message: 'Token is valid',
        user
      });

    } catch (error) {
      console.error('Verify token error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Update profile
  async updateProfile(req, res) {
    try {
      const {
        firstName,
        lastName,
        email,
        phone,
        password,
        companyName,
        companyType,
        licenseNumber,
        city
      } = req.body;

      // Build user updates only for allowed fields
      const userUpdates = {};
      if (firstName !== undefined) userUpdates.firstName = firstName;
      if (lastName !== undefined) userUpdates.lastName = lastName;
      if (email !== undefined) userUpdates.email = email;
      if (phone !== undefined) userUpdates.phone = phone;

      // Hash password if provided
      if (password) {
        const salt = await bcrypt.genSalt(10);
        userUpdates.password = await bcrypt.hash(password, salt);
      }

      let user = await User.findByIdAndUpdate(req.user.userId, userUpdates, {
        new: true,
        runValidators: true
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Determine if company fields are provided
      const companyFieldsProvided =
        companyName !== undefined ||
        companyType !== undefined ||
        licenseNumber !== undefined ||
        city !== undefined;

      // Update company if fields provided and user has a company
      if (companyFieldsProvided && user.company) {
        // Allow only managers to update company information
        if (user.role !== 'manager') {
          return res.status(403).json({
            success: false,
            message: 'Only managers can update company information'
          });
        }

        const companyUpdates = {};
        if (companyName !== undefined) companyUpdates.companyName = companyName;
        if (companyType !== undefined) companyUpdates.companyType = companyType;
        if (licenseNumber !== undefined) companyUpdates.licenseNumber = licenseNumber;
        if (city !== undefined) companyUpdates.city = city;

        try {
          await Company.findByIdAndUpdate(user.company, companyUpdates, {
            new: true,
            runValidators: true
          });
        } catch (err) {
          // Handle duplicate key or validation errors cleanly
          if (err && err.code === 11000) {
            return res.status(400).json({
              success: false,
              message: 'Company name or license number must be unique'
            });
          }
          throw err;
        }
      }

      // Return a populated, sanitized profile like getProfile
      user = await User.findById(req.user.userId).populate('company');
      const userObj = user.toObject();
      delete userObj.password;
      userObj.firstName = userObj.firstName || "";
      userObj.lastName = userObj.lastName || "";
      userObj.email = userObj.email || "";
      userObj.phone = userObj.phone || "";

      if (userObj.company) {
        userObj.companyName = userObj.company.companyName || "";
        userObj.companyType = userObj.company.companyType || "";
        userObj.licenseNumber = userObj.company.licenseNumber || "";
        userObj.city = userObj.company.city || "";
      } else {
        userObj.companyName = "";
        userObj.companyType = "";
        userObj.licenseNumber = "";
        userObj.city = "";
      }

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: userObj
      });

    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Update user (admin/manager function)
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const updates = { ...req.body };

      // Check if current user is super admin or manager of the same company
      const currentUser = await User.findById(req.user.userId);
      const targetUser = await User.findById(id);

      if (!currentUser || !targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const isSuperAdmin = currentUser.email.toLowerCase() === 'super.admin@gmail.com';
      if (!isSuperAdmin && (currentUser.role !== 'manager' || currentUser.company.toString() !== targetUser.company.toString())) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // If password provided, hash it
      if (updates.password) {
        const salt = await bcrypt.genSalt(10);
        updates.password = await bcrypt.hash(updates.password, salt);
      }

      const user = await User.findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        message: 'User updated successfully',
        user
      });

    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get all users (super admin only)
  async getAllUsers(req, res) {
    try {
      if (req.user.email.toLowerCase() !== 'super.admin@gmail.com') {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const users = await User.find().populate('company').sort({ createdAt: -1 });

      res.json({
        success: true,
        users
      });

    } catch (error) {
      console.error('Get all users error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Delete user (admin/manager function)
  async deleteUser(req, res) {
    try {
      const { id } = req.params;

      // Check if current user is super admin or manager of the same company
      const currentUser = await User.findById(req.user.userId);
      const targetUser = await User.findById(id);

      if (!currentUser || !targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const isSuperAdmin = currentUser.email.toLowerCase() === 'super.admin@gmail.com';
      if (!isSuperAdmin && (currentUser.role !== 'manager' || currentUser.company.toString() !== targetUser.company.toString())) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Prevent deleting self
      if (currentUser._id.toString() === id) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete your own account'
        });
      }

      // Delete the user
      await User.findByIdAndDelete(id);

      res.json({
        success: true,
        message: 'User deleted successfully'
      });

    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}

module.exports = new UserController();
