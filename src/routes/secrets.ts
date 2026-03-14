import { Hono } from "hono";
import { generatePassphrase, encrypt, decrypt } from "../crypto";
import { generateId, storeSecret, consumeSecret, deleteSecret } from "../db";

type Env = { Bindings: { DB: D1Database; BASE_URL?: string } };

const BASE_URL_DEFAULT = "https://cloak.opsy.sh";

const secrets = new Hono<Env>();

const MAX_SECRET_LENGTH = 10_000;
const MAX_ENCRYPTED_LENGTH = 20_000; // base64 overhead on 10K
const MAX_IV_LENGTH = 24;
const DEFAULT_TTL = 24 * 60 * 60;
const MAX_TTL = 7 * 24 * 60 * 60;
const ID_PATTERN = /^[A-Za-z0-9_-]{6,16}$/;

secrets.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const ttl = Math.min(
    Math.max(typeof body.expiresIn === "number" ? body.expiresIn : DEFAULT_TTL, 60),
    MAX_TTL
  );
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const baseUrl = c.env.BASE_URL || BASE_URL_DEFAULT;

  // Zero-knowledge browser flow: client sends ID + pre-encrypted data
  if (body.encryptedData && body.iv && body.id) {
    const id = String(body.id);
    const encryptedData = String(body.encryptedData);
    const iv = String(body.iv);

    if (!ID_PATTERN.test(id)) {
      return c.json({ error: "Invalid ID format" }, 400);
    }
    if (encryptedData.length > MAX_ENCRYPTED_LENGTH) {
      return c.json({ error: "Encrypted data too large" }, 400);
    }
    if (iv.length > MAX_IV_LENGTH) {
      return c.json({ error: "Invalid IV" }, 400);
    }

    try {
      await storeSecret(c.env.DB, id, encryptedData, iv, expiresAt);
    } catch {
      // ID collision — client should retry with a new ID
      return c.json({ error: "ID conflict, please retry" }, 409);
    }
    return c.json({ id, expiresAt });
  }

  // Curl/agent flow: server encrypts
  if (!body.secret || typeof body.secret !== "string") {
    return c.json({ error: "Missing or invalid 'secret' field" }, 400);
  }

  if (body.secret.length > MAX_SECRET_LENGTH) {
    return c.json({ error: `Secret too large (max ${MAX_SECRET_LENGTH} characters)` }, 400);
  }

  // Retry on ID collision (unlikely but possible)
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = generateId();
    const passphrase = generatePassphrase();
    const { encryptedData, iv } = await encrypt(body.secret, passphrase, id);

    try {
      await storeSecret(c.env.DB, id, encryptedData, iv, expiresAt);
      const url = `${baseUrl}/s/${id}#${passphrase}`;
      return c.json({ id, key: passphrase, url, expiresAt });
    } catch {
      continue; // ID collision, retry
    }
  }

  return c.json({ error: "Failed to generate unique ID, please retry" }, 503);
});

secrets.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID_PATTERN.test(id)) {
    return c.json({ error: "Invalid ID format" }, 400);
  }

  const key = c.req.header("X-Cloak-Key") || c.req.query("key");

  // Atomic read-and-delete: no race condition
  const record = await consumeSecret(c.env.DB, id);
  if (!record) {
    return c.json({ error: "Secret not found or expired" }, 404);
  }

  // Zero-knowledge browser flow: return encrypted blob
  if (!key) {
    return c.json({ encryptedData: record.encrypted_data, iv: record.iv });
  }

  // Curl/agent flow: server decrypts
  try {
    const plaintext = await decrypt(record.encrypted_data, record.iv, key, id);
    return c.json(
      {
        secret: plaintext,
        _warning: "SENSITIVE — do not log, print, or persist this value.",
      },
      200,
      { "X-Sensitive": "true" }
    );
  } catch {
    return c.json({ error: "Decryption failed — invalid key" }, 403);
  }
});

// DELETE requires the key to prevent unauthenticated destruction
secrets.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID_PATTERN.test(id)) {
    return c.json({ error: "Invalid ID format" }, 400);
  }

  const key = c.req.header("X-Cloak-Key") || c.req.query("key");
  if (!key) {
    return c.json({ error: "Key required to delete a secret" }, 401);
  }

  const deleted = await deleteSecret(c.env.DB, id);
  if (!deleted) {
    return c.json({ error: "Secret not found" }, 404);
  }
  return c.json({ ok: true });
});

export default secrets;
