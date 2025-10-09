const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company.controller');
const authMiddleware = require('../../shared/middlewares/auth.middleware');

// All company routes require authentication
router.use(authMiddleware);

// Create company
router.post('/', companyController.createCompany);

// Get all companies
router.get('/', companyController.getCompanies);

// Get company by id
router.get('/:id', companyController.getCompanyById);

// Update company
router.put('/:id', companyController.updateCompany);

// Delete company
router.delete('/:id', companyController.deleteCompany);

// Get users by company
router.get('/:id/users', companyController.getUsersByCompany);

// Add user to company
router.post('/:id/users', companyController.addUserToCompany);

module.exports = router;
