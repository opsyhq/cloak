import { cleanupExpired } from "./db";

export async function handleScheduled(
  _event: ScheduledEvent,
  env: { DB: D1Database }
): Promise<void> {
  const deleted = await cleanupExpired(env.DB);
  console.log(`Cron cleanup: deleted ${deleted} expired secrets`);
}
