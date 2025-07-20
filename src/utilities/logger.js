// -- logger.js
require('winston-daily-rotate-file');
const fs     = require('fs');
const path   = require('path');
// const Sentry = require('winston-transport-sentry-node').default;
const { createLogger, format, transports } = require('winston');

// ─── Ensure logs directory exists ─────────────────────────────────────
const logDirectory = './logs/';
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

// ─── Create main logger ───────────────────────────────────────────────
const logger = createLogger({
  level: 'info', // minimum level to log
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  exitOnError: false,
});

// ─── File transport: JSONL for all logs ───────────────────────────────
logger.add(new transports.DailyRotateFile({
  filename: path.join(logDirectory, 'combined-%DATE%.jsonl'),
  datePattern: 'YYYY-MM-DD',
  maxFiles: '7d',
  level: 'info', // includes info, warn, error
}));

// ─── Sentry integration for production ────────────────────────────────
if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN) {
  logger.add(new Sentry({
    sentry: { dsn: process.env.SENTRY_DSN },
    level: 'error',
  }));
}

module.exports = logger;
