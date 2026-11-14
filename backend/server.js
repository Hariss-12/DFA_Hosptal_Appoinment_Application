/**
 * Online Hospital Appointment Management System Using DFA — Express Application & Server
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const ENV = require('./config/env');
const { connectDB, mongoose } = require('./config/db');
const {
  securityHeaders,
  corsMiddleware,
  sanitizeInputMiddleware,
} = require('./middleware/validateMiddleware');
const { apiRateLimiter } = require('./middleware/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { getDFADefinition } = require('./controllers/appointmentController');

const authRoutes = require('./routes/authRoutes');
const doctorRoutes = require('./routes/doctorRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// 1. Security & Parsing Middleware
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json({ limit: '256kb' }));
app.use(sanitizeInputMiddleware);
app.use('/api', apiRateLimiter);

// 2. Phase 1 Health-Check & Formal DFA Definition Endpoints
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'OK',
    service: 'Online Hospital Appointment Management System (DFA Engine)',
    database: {
      connected: mongoose.connection.readyState === 1,
      name: mongoose.connection.name,
    },
    dfaStates: ['REQUESTED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'REJECTED', 'COMPLETED'],
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/dfa/definition', getDFADefinition);

// 3. Domain Routes
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/admin', adminRoutes);

// Serve the built React application from the same Render web service when present.
const frontendDist = path.resolve(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      return next();
    }
    return res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// 4. Centralized 404 & Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

async function startServer(port = ENV.PORT, options = {}) {
  await connectDB(options);
  return new Promise((resolve) => {
    const server = app.listen(port, '0.0.0.0', () => {
      resolve(server);
    });
  });
}

if (require.main === module) {
  const { seedDatabase } = require('./utils/seed');
  startServer(ENV.PORT)
    .then(async (server) => {
      await seedDatabase({ forceReset: false });
      const addr = server.address();
      console.log(
        `[Hospital DFA Backend] Server listening on 0.0.0.0:${addr.port} (DB readyState=${mongoose.connection.readyState})`
      );
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}

module.exports = {
  app,
  startServer,
};
