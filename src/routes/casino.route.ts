import { getAllGames, getCasinoStatistics, getCasinoTransactions, getCategories, getGameById, launchGame, placeCasinoBet, processCasinoWin } from '@/controllers/casino.controller';
import { verifyToken } from '@/middlewares/auth.middleware';
import { Router } from 'express';


const router = Router();

// Get games
router.get('/games', getAllGames);

// Get game by ID
router.get('/games/:gameId', getGameById);

// Get categories
router.get('/categories', getCategories);

// Launch game
router.post('/launch', verifyToken, launchGame);

// Place bet
router.post('/bet', verifyToken, placeCasinoBet);

// Process win
router.post('/win', verifyToken, processCasinoWin);

// Get transactions
router.get('/transactions', verifyToken, getCasinoTransactions);

// Get statistics
router.get('/statistics', verifyToken, getCasinoStatistics);

export default router;