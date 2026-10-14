// node src/tools/notify.js "message" — send one Telegram message and exit.
// Used by the supervisor script, which cannot reach Telegram any other way
// once the system itself keeps crashing.
import { TelegramControl } from '../alerts/telegram.js';

const text = process.argv.slice(2).join(' ').trim();
if (text) await new TelegramControl({ api: null }).send(text);
setTimeout(() => process.exit(0), 300);
