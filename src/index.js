// Entry point.
//   npm start        — run the portfolio manager (paper by default)
//   npm run status   — print current status as JSON and exit
import { CONFIG } from '../config/portfolio.js';
import { TelegramControl } from './alerts/telegram.js';
import { createDefaultRegistry } from './buckets/registry.js';
import { ControlApi } from './control/controlApi.js';
import { getStore } from './persistence/db.js';
import { PortfolioManager } from './portfolio/portfolioManager.js';
import { createLogger } from './shared/logger.js';

const log = createLogger('MAIN');

function build() {
  const store     = getStore();
  const registry  = createDefaultRegistry(CONFIG, { store });
  const portfolio = new PortfolioManager({ config: CONFIG, store, registry });
  const api       = new ControlApi({ portfolio, store });
  return { store, portfolio, api };
}

async function main() {
  const cmd = process.argv[2] ?? 'run';
  const { store, portfolio, api } = build();

  if (cmd === 'status') {
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

  log.info({ mode: CONFIG.mode }, '=== CAPITAL SYSTEM STARTING ===');
  const telegram = new TelegramControl({ api });
  await portfolio.start();
  telegram.start();

  let stopping = false;
  const shutdown = async signal => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'Shutting down');
    await portfolio.stop();
    await telegram.stop();
    store.close();
    setTimeout(() => process.exit(0), 250);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', err => log.error({ err: err?.message ?? String(err) }, 'Unhandled rejection'));
}

main().catch(err => {
  log.fatal({ err: err.message }, 'Fatal startup error');
  setTimeout(() => process.exit(1), 250);
});
