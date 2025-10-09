const userRoutes = require('./users.routes')
const express = require('express');
const mongoose = require('mongoose');

const paymentRouter = require('./payment.routes');
const scriptRouter = require('./script.routes');
const reportsRouter = require('./reports.routes'); // Add this line
const ticketRouter = require('./ticket.routes');
const messageRouter = require('./message.routes');
const companyRouter = require('./companies.routes');

const router = express.Router();
router.use('/api/users', userRoutes);
router.use('/api/payments', paymentRouter);
router.use('/api/scripts', scriptRouter);
router.use('/api/reports', reportsRouter); // Add this line
router.use('/api/tickets', ticketRouter);
router.use('/api/messages', messageRouter);
router.use('/api/companies', companyRouter);

router.get('/', (_req, res) => {
  res.json({ message: 'Welcome to front-logic API' });
});

router.get('/health', (_req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting', 'uninitialized'];
  const state = states[mongoose.connection.readyState] || 'unknown';
  res.json({ status: 'ok', dbState: state });
});

module.exports = router;