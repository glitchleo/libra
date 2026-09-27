import { env } from './config/env.js';
import { createRuntime } from './runtime.js';

const runtime = createRuntime();
const server = runtime.app.listen(env.PORT, env.HOST, () => {
  console.info('Libra is running at http://' + env.HOST + ':' + env.PORT);
});
server.on('error', async () => {
  console.error('Could not start Libra. Check that the configured host and port are available.');
  await runtime.close(); process.exit(1);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(async () => { await runtime.close(); process.exit(0); }));
}
