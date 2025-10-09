const mongoose = require('mongoose');
const User = require('./src/infrastructure/models/user.model');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function checkSuperAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Find super admin
    const admin = await User.findOne({ email: 'super.admin@gmail.com' });
    if (!admin) {
      console.log('Super admin not found');
      return;
    }

    console.log('Super admin found:');
    console.log('Email:', admin.email);
    console.log('First Name:', admin.firstName);
    console.log('Last Name:', admin.lastName);
    console.log('Role:', admin.role);
    console.log('Is Active:', admin.isActive);
    console.log('Hashed Password:', admin.password);

    // Test password
    const testPasswords = ['admin123', '123456', 'password', 'superadmin'];
    for (const pwd of testPasswords) {
      const isValid = await bcrypt.compare(pwd, admin.password);
      console.log(`Password "${pwd}" valid:`, isValid);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

checkSuperAdmin();
