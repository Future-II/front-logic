const express = require('express');
const userController = require('../controllers/user.controller');
const authMiddleware = require('../../shared/middlewares/auth.middleware');

const userRoutes = express.Router();

// Public routes
userRoutes.post('/auth/register', userController.register);
userRoutes.post('/auth/login', userController.login);

// Protected routes
userRoutes.get('/', authMiddleware, userController.getAllUsers);
userRoutes.get('/profile', authMiddleware, userController.getProfile);
userRoutes.put('/profile', authMiddleware, userController.updateProfile);
userRoutes.put('/:id', authMiddleware, userController.updateUser);
userRoutes.delete('/:id', authMiddleware, userController.deleteUser);
userRoutes.get('/verify', authMiddleware, userController.verifyToken);

module.exports = userRoutes;
