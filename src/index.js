// Entry point.
//   npm start        — run the portfolio manager (paper by default)
//   npm run paper    — the same, under the restart supervisor (scripts/paper-run.ps1)
//   npm run status   — print current status as JSON and exit
//
// Exit codes: 0 clean stop, 1 crash or fatal startup error,
// 3 another copy already holds the lock (the supervisor does not retry).
import { CONFIG } from '../config/portfolio.js';
import { TelegramControl } from './alerts/telegram.js';
import { createDefaultRegistry } from './buckets/registry.js';
import { ControlApi } from './control/controlApi.js';
import { getStore } from './persistence/db.js';
import { PortfolioManager } from './portfolio/portfolioManager.js';
import { LOCK_HELD_EXIT_CODE, acquireLock, lockPathFor } from './shared/instanceLock.js';
import { createLogger } from './shared/logger.js';

const log = createLogger('MAIN');
const FLUSH_MS = 500; // lets the Pino transport write the last lines before exit

function build() {
  const store     = getStore();
  const registry  = createDefaultRegistry(CONFIG, { store });
  const portfolio = new PortfolioManager({ config: CONFIG, store, registry });
  const api       = new ControlApi({ portfolio, store });
  return { store, portfolio, api };
}

async function main() {
  const cmd = process.argv[2] ?? 'run';

  if (cmd === 'status') {
    const { store, portfolio, api } = build();
    portfolio.init();
    console.log(JSON.stringify(api.getStatus(), null, 2));
    store.close();
    return;
  }

  if (cmd !== 'run') {
    console.error(`Unknown command: ${cmd} (use: run | status)`);
    process.exitCode = 1;
    return;
  }

  const lock = acquireLock(lockPathFor(CONFIG.db.path));
  if (!lock.ok) {
    log.error({ ownerPid: lock.pid, ownerStartedAt: lock.startedAt, lock: lock.path },
      'Another copy is already running against this database — not starting. If none is running, delete the lock file.');
    await new TelegramControl({ api: null }).send(`⚠️ A second copy of the capital system tried to start and was refused (pid ${lock.pid} is running).`);
    setTimeout(() => process.exit(LOCK_HELD_EXIT_CODE), FLUSH_MS);
    return;
  }
  process.on('exit', () => lock.release());

  // After an uncaught exception the process state is unknown, so log and exit
  // without a clean shutdown; the next start reports it as unclean.
  process.on('uncaughtException', err => {
    log.fatal({ err: err.message, stack: err.stack }, 'Uncaught exception — exiting');
    setTimeout(() => process.exit(1), FLUSH_MS);
  });
  process.on('unhandledRejection', err => log.error({ err: err?.message ?? String(err) }, 'Unhandled rejection'));

  const { store, portfolio, api } = build();
  log.info({ mode: CONFIG.mode }, '=== CAPITAL SYSTEM STARTING ===');
  const telegram = new TelegramControl({ api });

  let stopping = false;
  const shutdown = async signal => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'Shutting down');
    await portfolio.stop();
    await telegram.stop();
    store.close();
    setTimeout(() => process.exit(0), FLUSH_MS);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await portfolio.start();
  telegram.start();
}

main().catch(err => {
  log.fatal({ err: err.message, stack: err.stack }, 'Fatal startup error');
  setTimeout(() => process.exit(1), FLUSH_MS);
});
