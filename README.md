# Cloak

One-time secret sharing for humans and agents. AES-256-GCM encrypted, zero-knowledge in the browser, open source.

**[cloak.opsy.sh](https://cloak.opsy.sh)**

---

## The Problem

You need to send someone an API key, database password, or token. You can't put it in Slack, email, or a terminal log — it'll live there forever. You need a link that works once and then self-destructs.

## How It Works

```
https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL
                       ^^^^^^^^ ^^^^^^^^^^^^^^^^
                       ID        encryption key (never sent to server)
```

1. **Create** — encrypt a secret, get a short URL
2. **Share** — send the URL to the recipient (the key is in the `#fragment`, never sent to the server)
3. **Open** — recipient opens the URL, secret is decrypted and permanently destroyed

The browser flow is **zero-knowledge**: the server only stores an encrypted blob and never sees the plaintext or the key. The key stays in the URL fragment, which browsers never send to the server.

---

## Usage

### Browser

Go to [cloak.opsy.sh](https://cloak.opsy.sh). Paste your secret. Get a link. Share it.

### curl / API

**Create a secret:**
```bash
curl -s -X POST https://cloak.opsy.sh/api/secrets \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$MY_SECRET\"}"
```

Response:
```json
{
  "id": "W9ZEykcG",
  "key": "8g9I3UUBjH3x4kdL",
  "url": "https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL",
  "expiresAt": 1710000000
}
```

**Retrieve a secret** (use the `X-Cloak-Key` header):
```bash
curl -s -H "X-Cloak-Key: 8g9I3UUBjH3x4kdL" \
  "https://cloak.opsy.sh/api/secrets/W9ZEykcG"
```

Response:
```json
{ "secret": "the-plaintext-value" }
```

The secret is destroyed after this request. A second request returns 404.

**Pipe directly to an env var** (secret never appears in terminal):
```bash
export DB_PASSWORD=$(curl -s -H "X-Cloak-Key: KEY" \
  "https://cloak.opsy.sh/api/secrets/ID" | jq -r .secret)
```

### CLI

```bash
# Create (reads from stdin)
echo "$SECRET" | bunx @opsy/cloak create
echo "$SECRET" | bunx @opsy/cloak create --ttl 1h

# Retrieve
bunx @opsy/cloak get "https://cloak.opsy.sh/s/ID#KEY"

# Retrieve as export statement
bunx @opsy/cloak get "https://cloak.opsy.sh/s/ID#KEY" --env
# → export SECRET='the-value'
```

---

## API Reference

### `POST /api/secrets`

Create a secret. Two modes:

**Server-encrypt (curl/agent)** — send plaintext, server encrypts:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `secret` | string | yes | The secret to share (max 10,000 chars) |
| `expiresIn` | number | no | TTL in seconds (default: 86400, min: 60, max: 604800) |

**Client-encrypt (browser, zero-knowledge)** — send pre-encrypted blob:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Client-generated ID (6-16 alphanumeric chars) |
| `encryptedData` | string | yes | Base64url-encoded ciphertext |
| `iv` | string | yes | Base64url-encoded IV |
| `expiresIn` | number | no | TTL in seconds |

**Response (server-encrypt):**
```json
{
  "id": "W9ZEykcG",
  "key": "8g9I3UUBjH3x4kdL",
  "url": "https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL",
  "expiresAt": 1710000000
}
```

**Response (client-encrypt):**
```json
{
  "id": "W9ZEykcG",
  "expiresAt": 1710000000
}
```

Returns `409` on ID collision (client should retry with a new ID).

---

### `GET /api/secrets/:id`

Retrieve and destroy a secret. Two modes:

**Server-decrypt (curl/agent)** — send the key, get plaintext back:
```
GET /api/secrets/W9ZEykcG
X-Cloak-Key: 8g9I3UUBjH3x4kdL
```

Response: `{ "secret": "the-plaintext-value" }`

**Client-decrypt (browser, zero-knowledge)** — omit the key, get the encrypted blob:
```
GET /api/secrets/W9ZEykcG
```

Response: `{ "encryptedData": "...", "iv": "..." }`

In both modes, the secret is atomically deleted upon retrieval. Returns `404` if not found, expired, or already read. Returns `403` if the key is wrong.

---

### `DELETE /api/secrets/:id`

Destroy a secret without reading it. Requires the key for authorization.

```
DELETE /api/secrets/W9ZEykcG
X-Cloak-Key: 8g9I3UUBjH3x4kdL
```

Response: `{ "ok": true }`

---

## For AI Agents

When an agent receives a Cloak URL, it needs to:

1. Parse the URL: ID is the path after `/s/`, key is the fragment after `#`
2. Call the API with the key in the `X-Cloak-Key` header
3. **Never display the secret value in conversation** — pipe it directly to a file, env var, or another command
4. Confirm to the user that the secret was retrieved and stored, without showing the value

The Cloak reveal page embeds agent instructions in a hidden DOM element. Agents that fetch the page as HTML will find retrieval instructions. Agents can also request JSON instructions by fetching the `/s/:id` URL with `Accept: application/json`.

### OpenClaw Skill

The `skill/SKILL.md` file teaches agents how to use Cloak via curl. It includes step-by-step instructions, security rules, and a quick reference table.

```bash
openclaw skills publish skill/
```

### OpenClaw Plugin

The `plugin/` directory provides `cloak_create` and `cloak_get` as native agent tools:

```json
{
  "source": "exec",
  "provider": "cloak",
  "command": "cloak-resolver",
  "passEnv": ["CLOAK_URL"]
}
```

### OpenClaw Secret Provider

The `cli/openclaw-resolver.ts` acts as an `exec` secret provider. It reads Cloak references from stdin and resolves them to plaintext values, so secrets can be injected into agent environments without ever appearing in conversation.

Input:
```json
{ "protocolVersion": 1, "provider": "cloak", "ids": ["W9ZEykcG#8g9I3UUBjH3x4kdL"] }
```

Output:
```json
{ "protocolVersion": 1, "values": { "W9ZEykcG#8g9I3UUBjH3x4kdL": "the-secret" } }
```

---

## Security

### Encryption

- **AES-256-GCM** symmetric encryption via the Web Crypto API
- **HKDF-SHA256** key derivation: a short passphrase (96 bits) + the secret ID (as salt) derive the full 256-bit encryption key
- **96-bit passphrase entropy**: not brute-forceable even if an attacker obtains the encrypted blob from the database

### Zero-Knowledge (Browser Flow)

The browser generates both the ID and passphrase locally, derives the AES key via HKDF, encrypts the secret client-side, and sends only the encrypted blob to the server. The passphrase stays in the URL fragment, which browsers never transmit. On reveal, the browser fetches the encrypted blob (without sending the key), derives the key locally, and decrypts in the browser. **The server never sees the plaintext or the encryption key.**

### curl/Agent Flow

When using curl or the CLI, the server handles encryption and decryption. The plaintext is sent over TLS and is never stored — only the encrypted blob persists. This is a documented tradeoff for convenience. For true zero-knowledge from the terminal, use the `cloak` CLI which can perform client-side encryption (same as the browser).

### Other

- **Atomic one-time read**: secrets are deleted in the same database operation that reads them — no race condition
- **Authenticated delete**: the `DELETE` endpoint requires the encryption key, preventing unauthenticated destruction
- **Auto-expiry**: expired secrets are cleaned up hourly via Cloudflare Cron Triggers
- **CORS restricted**: API only accepts requests from the app's own origin
- **No crawling**: `robots.txt` blocks `/s/` and `/api/`, `X-Robots-Tag` headers on all API responses, `noindex` meta tags on secret pages

---

## Self-Hosting

```bash
git clone https://github.com/opsyhq/cloak
cd cloak
bun install

# Create the D1 database
wrangler d1 create cloak-db
# Copy the database_id into wrangler.toml

# Apply schema
bun run db:init

# Local development
bun run dev

# Deploy to Cloudflare
bun run deploy
```

Set `BASE_URL` in your wrangler.toml `[vars]` section if you're using a custom domain:
```toml
[vars]
BASE_URL = "https://secrets.yourdomain.com"
```

---

## Architecture

```
Browser (zero-knowledge)          API (Hono on CF Worker)         D1 (SQLite)
  │                                  │                              │
  ├─ generate ID + passphrase        │                              │
  ├─ HKDF(passphrase, ID) → key     │                              │
  ├─ AES-256-GCM encrypt            │                              │
  ├─ POST {id, encryptedData, iv} ──→├─ store encrypted blob ──────→│
  │                                  │                              │
  ├─ GET /api/secrets/:id ──────────→├─ atomic delete + return blob→│
  ├─ HKDF(passphrase, ID) → key     │                              │
  ├─ AES-256-GCM decrypt            │                              │
  └─ display secret                  │                              │

curl/Agent (server-assisted)
  │                                  │                              │
  ├─ POST {secret} ────────────────→├─ generate ID + passphrase    │
  │                                  ├─ HKDF(passphrase, ID) → key │
  │                                  ├─ encrypt + store ───────────→│
  │← {id, key, url} ────────────────┤                              │
  │                                  │                              │
  ├─ GET /api/secrets/:id ──────────→├─ atomic delete + decrypt ───→│
  │  X-Cloak-Key: passphrase        │                              │
  │← {secret} ──────────────────────┤                              │
```

---

## License

MIT
