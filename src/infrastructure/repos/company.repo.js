const Company = require('../models/company.model');

class CompanyRepository {
  async create(companyData) {
    const company = new Company(companyData);
    return await company.save();
  }

  async findById(id) {
    return await Company.findById(id).populate('users').populate('createdBy');
  }

  async findAll() {
    return await Company.find({}).populate('users').populate('createdBy');
  }

  async findByCreatedBy(userId) {
    return await Company.find({ createdBy: userId }).populate('users');
  }

  async addUser(companyId, userId) {
    return await Company.findByIdAndUpdate(
      companyId,
      { $addToSet: { users: userId } },
      { new: true }
    ).populate('users');
  }

  async removeUser(companyId, userId) {
    return await Company.findByIdAndUpdate(
      companyId,
      { $pull: { users: userId } },
      { new: true }
    ).populate('users');
  }

  async update(companyId, updates) {
    return await Company.findByIdAndUpdate(companyId, updates, { new: true }).populate('users').populate('createdBy');
  }

  async delete(id) {
    return await Company.findByIdAndDelete(id);
  }
}

module.exports = new CompanyRepository();
