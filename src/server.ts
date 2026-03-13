import 'dotenv/config';
import app from './app';
import { initializeSchema, testDbConnection } from './db';
import { setupKonsier } from './konsier';

const PORT = Number(process.env.PORT) || 3000;

async function startServer(): Promise<void> {
  await testDbConnection();
  await initializeSchema();

  const konsier = setupKonsier(app);

  app.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);

    if (!konsier.enabled || !konsier.sync) {
      return;
    }

    try {
      await konsier.sync();
      console.log(
        `Konsier synced successfully. Webhook path: ${konsier.webhookPath ?? '/konsier'}`
      );
    } catch (error: unknown) {
      console.error('Konsier sync failed', error);
    }
  });
}

startServer().catch((error: unknown) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
