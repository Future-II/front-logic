const mongoose = require('mongoose');
const User = require('./src/infrastructure/models/user.model');
require('dotenv').config();

async function createSuperAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Check if super admin already exists
    const existingAdmin = await User.findOne({ email: 'super.admin@gmail.com' });
    if (existingAdmin) {
      console.log('Super admin already exists');
      return;
    }

    // Create super admin user
    const superAdmin = new User({
      firstName: 'Super',
      lastName: 'Admin',
      email: 'super.admin@gmail.com',
      password: 'admin123', // This will be hashed by the pre-save hook
      role: 'admin',
      isActive: true,
      termsAccepted: true
    });

    await superAdmin.save();
    console.log('Super admin created successfully');
    console.log('Email: super.admin@gmail.com');
    console.log('Password: admin123');

  } catch (error) {
    console.error('Error creating super admin:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

createSuperAdmin();
