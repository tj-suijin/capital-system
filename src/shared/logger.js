// Pino structured logging. Pretty output to the console, JSON to logs/app.log,
// errors additionally to logs/errors.log.
import path from 'node:path';
import pino from 'pino';
import { CONFIG } from '../../config/portfolio.js';

function buildRoot() {
  const level = process.env.LOG_LEVEL
    ?? (process.env.NODE_TEST_CONTEXT ? 'silent' : CONFIG.log.level);

  if (level === 'silent') return pino({ level });

  const dir = CONFIG.log.dir;
  const transport = pino.transport({
    targets: [
      {
        target: 'pino-pretty',
        level,
        options: { colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' },
      },
      { target: 'pino/file', level, options: { destination: path.join(dir, 'app.log'), mkdir: true } },
      { target: 'pino/file', level: 'error', options: { destination: path.join(dir, 'errors.log'), mkdir: true } },
    ],
  });
  return pino({ level }, transport);
}

const root = buildRoot();

export function createLogger(mod) {
  return root.child({ mod });
}

export default createLogger;
