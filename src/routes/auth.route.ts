import { changePassword, getCurrentUser, login, logout, register } from '@/controllers/auth.controller';
import { verifyToken } from '@/middlewares/auth.middleware';
import { Router } from 'express';


const router = Router();

// Login
router.post('/login', login);

// Get current user
router.get('/me', verifyToken, getCurrentUser);

// Register (optional)
router.post('/register', register);

// Change password
router.post('/change-password', verifyToken, changePassword);

// Logout
router.post('/logout', verifyToken, logout);

export default router;