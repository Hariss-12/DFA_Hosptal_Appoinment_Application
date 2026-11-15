/**
 * Environment Variable Loader & Validator
 *
 * Parses .env files without external dependencies if dotenv is unavailable,
 * and enforces presence of critical security secrets.
 */

const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

loadEnvFile();

const ENV = {
  PORT: Number(process.env.PORT || 5050),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hospital_dfa_db',
  USE_LOCAL_DB: process.env.USE_LOCAL_DB === 'true',
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '4h',
  CORS_ORIGIN: [
    ...new Set([
      ...(process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      'https://hariss-12.github.io',
    ]),
  ].join(','),
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  RATE_LIMIT_MAX_REQUESTS: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 500),
  AUTH_RATE_LIMIT_MAX: Number(process.env.AUTH_RATE_LIMIT_MAX || 50),
};

if (!ENV.JWT_SECRET || ENV.JWT_SECRET.length < 32) {
  throw new Error(
    'FATAL SECURITY ERROR: JWT_SECRET environment variable must be configured and at least 32 characters long.'
  );
}

module.exports = ENV;
