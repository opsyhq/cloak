export interface SecretRecord {
  id: string;
  encrypted_data: string;
  iv: string;
  expires_at: number;
  created_at: number;
}

const ID_BYTES = 6; // 48 bits → 8 base64url chars
const MAX_RETRIES = 3;

export function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function storeSecret(
  db: D1Database,
  id: string,
  encryptedData: string,
  iv: string,
  expiresAt: number
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO secrets (id, encrypted_data, iv, expires_at) VALUES (?, ?, ?, ?)"
    )
    .bind(id, encryptedData, iv, expiresAt)
    .run();
}

// Atomic read-and-delete: prevents race condition where two concurrent
// requests could both read the same secret before either deletes it.
export async function consumeSecret(
  db: D1Database,
  id: string
): Promise<SecretRecord | null> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      "DELETE FROM secrets WHERE id = ? AND expires_at > ? RETURNING id, encrypted_data, iv, expires_at, created_at"
    )
    .bind(id, now)
    .first<SecretRecord>();
  return result ?? null;
}

// Non-destructive read for decrypt-then-delete flow
export async function getSecret(
  db: D1Database,
  id: string
): Promise<SecretRecord | null> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare("SELECT * FROM secrets WHERE id = ? AND expires_at > ?")
    .bind(id, now)
    .first<SecretRecord>();
  return result ?? null;
}

export async function deleteSecret(
  db: D1Database,
  id: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM secrets WHERE id = ?")
    .bind(id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function cleanupExpired(db: D1Database): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare("DELETE FROM secrets WHERE expires_at <= ?")
    .bind(now)
    .run();
  return result.meta.changes ?? 0;
}
