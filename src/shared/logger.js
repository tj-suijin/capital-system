// Pino structured logging. Pretty output to the console, JSON to logs/app.log,
// errors additionally to logs/errors.log.
//
// Every error-level (or worse) line is also passed to onLogError listeners,
// so the health monitor can alert on bursts of errors.
import path from 'node:path';
import pino from 'pino';
import { CONFIG } from '../../config/portfolio.js';

const ERROR_LEVEL = 50;
const errorListeners = new Set();

export function onLogError(fn) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

const hooks = {
  logMethod(args, method, level) {
    if (level >= ERROR_LEVEL && errorListeners.size) {
      try {
        const [a, b] = args;
        const obj = a && typeof a === 'object' ? a : {};
        const e = { mod: this.bindings?.().mod ?? null, msg: typeof a === 'string' ? a : b ?? null, code: obj.code ?? null, ts: Date.now() };
        for (const fn of errorListeners) fn(e);
      } catch { /* never let alerting break logging */ }
    }
    return method.apply(this, args);
  },
};

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
  return pino({ level, hooks }, transport);
}

const root = buildRoot();

export function createLogger(mod) {
  return root.child({ mod });
}

export default createLogger;
