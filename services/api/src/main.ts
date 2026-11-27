// Запуск сервиса: DATABASE_URL, CSRF_SECRET, PORT (по умолчанию 3000).
import { configFromEnv } from './config.ts';
import { createApp } from './app.ts';
import { LogMailer } from './mail.ts';

const cfg = configFromEnv();
const app = await createApp(cfg, new LogMailer());
await app.listen(Number(process.env['PORT'] ?? 3000), '0.0.0.0');
console.log(`api: ${await app.getUrl()}/api/v1`);
