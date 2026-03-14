<p align="center">
  <h1 align="center">🔒 Cloak</h1>
  <p align="center"><strong>One-time secret sharing for humans & agents.</strong></p>
  <p align="center">
    Share API keys, passwords, and tokens via encrypted<br/>
    self-destructing links. Zero-knowledge in the browser.
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@opsyhq/cloak"><img src="https://img.shields.io/npm/v/@opsyhq/cloak" alt="npm version"></a>
  <a href="https://github.com/opsyhq/cloak/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license"></a>
  <a href="https://github.com/opsyhq/cloak/actions/workflows/deploy.yml"><img src="https://github.com/opsyhq/cloak/actions/workflows/deploy.yml/badge.svg" alt="deploy"></a>
</p>

<p align="center">
  <a href="https://cloak.opsy.sh">Live App</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#api">API</a> ·
  <a href="#for-ai-agents">For AI Agents</a> ·
  <a href="#self-hosting">Self-Hosting</a>
</p>

---

You need to send someone an API key, database password, or token. You can't put it in Slack, email, or a terminal log — it'll live there forever.

**Cloak creates encrypted, self-destructing secret links.** Share the link. It works once. Then the secret is permanently destroyed.

```
https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL
                       ^^^^^^^^ ^^^^^^^^^^^^^^^^
                       ID        key (never sent to server)
```

> **Zero-knowledge in the browser.** The encryption key stays in the URL fragment — browsers never send it to the server. The server only stores an encrypted blob it can't read.

## Quickstart

### 1. Browser

Open [cloak.opsy.sh](https://cloak.opsy.sh). Paste your secret. Get a link. Share it.

### 2. curl

```bash
# Create
curl -s -X POST https://cloak.opsy.sh/api/secrets \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$MY_SECRET\"}"
# → {"id":"W9ZEykcG","key":"8g9I3UUBjH3x4kdL","url":"https://cloak.opsy.sh/s/W9ZEykcG#..."}

# Retrieve — straight to env var, never printed
export MY_SECRET=$(curl -s -H "X-Cloak-Key: 8g9I3UUBjH3x4kdL" \
  "https://cloak.opsy.sh/api/secrets/W9ZEykcG" | jq -r .secret)
```

### 3. CLI

```bash
# Create (reads from stdin)
echo "$SECRET" | npx @opsyhq/cloak create
echo "$SECRET" | npx @opsyhq/cloak create --ttl 1h

# Retrieve
npx @opsyhq/cloak get "https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL"

# Retrieve as export statement
npx @opsyhq/cloak get "https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL" --env
# → export SECRET='the-value'
```

## How It Works

The browser generates a random ID and passphrase, derives an AES-256 key via HKDF, encrypts the secret client-side, and sends only the encrypted blob to the server. The passphrase stays in the URL fragment, which browsers never transmit.

On reveal, the browser fetches the encrypted blob (without sending the key), derives the key locally, and decrypts. **The server never sees the plaintext or the encryption key.**

The curl/agent flow is server-assisted — plaintext is sent over TLS and encrypted on the server. It's never stored in plaintext.

## API

### `POST /api/secrets`

Create a secret.

```bash
curl -s -X POST https://cloak.opsy.sh/api/secrets \
  -H "Content-Type: application/json" \
  -d '{"secret":"sk-abc123", "expiresIn": 3600}'
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `secret` | string | required | The secret (max 10,000 chars) |
| `expiresIn` | number | 86400 | TTL in seconds (min 60, max 604800) |

Response:
```json
{
  "id": "W9ZEykcG",
  "key": "8g9I3UUBjH3x4kdL",
  "url": "https://cloak.opsy.sh/s/W9ZEykcG#8g9I3UUBjH3x4kdL",
  "expiresAt": 1710000000
}
```

### `GET /api/secrets/:id`

Retrieve and destroy a secret.

```bash
curl -s -H "X-Cloak-Key: 8g9I3UUBjH3x4kdL" \
  "https://cloak.opsy.sh/api/secrets/W9ZEykcG"
# → {"secret":"sk-abc123"}
```

The secret is atomically deleted upon retrieval. Returns `404` if not found, expired, or already read.

### `DELETE /api/secrets/:id`

Destroy a secret without reading it. Requires the key.

```bash
curl -s -X DELETE -H "X-Cloak-Key: 8g9I3UUBjH3x4kdL" \
  "https://cloak.opsy.sh/api/secrets/W9ZEykcG"
# → {"ok":true}
```

## For AI Agents

When an agent receives a Cloak URL:

1. **Parse the URL** — ID is the path after `/s/`, key is the fragment after `#`
2. **Call the API** — `curl -s -H "X-Cloak-Key: KEY" "https://cloak.opsy.sh/api/secrets/ID"`
3. **Never display the secret** — pipe it to a file, env var, or command. Never echo it in conversation.

The reveal page embeds agent instructions in a hidden DOM element and supports `Accept: application/json` for structured retrieval instructions.

<details>
<summary><strong>ClawHub Skill</strong></summary>

Published to [ClawHub](https://clawhub.ai) as [`cloak`](https://clawhub.ai/saba-ch/cloak). Install it:

```bash
clawhub install cloak
```
</details>

<details>
<summary><strong>OpenClaw Plugin</strong></summary>

The `plugin/` directory registers `cloak_create` and `cloak_get` as native agent tools.

The `cli/openclaw-resolver.ts` acts as an `exec` secret provider — secrets get injected into agent environments without appearing in conversation.

```json
{
  "source": "exec",
  "provider": "cloak",
  "command": "cloak-resolver",
  "passEnv": ["CLOAK_URL"]
}
```
</details>

## Security

- **AES-256-GCM** with HKDF-SHA256 key derivation (96-bit passphrase entropy)
- **Zero-knowledge browser flow** — server never sees plaintext or key
- **Atomic one-time read** — `DELETE ... RETURNING` prevents race condition double-reads
- **Authenticated delete** — requires the encryption key
- **CORS restricted** — API only accepts requests from the app's origin
- **No crawling** — `robots.txt`, `X-Robots-Tag` headers, `noindex` meta tags
- **Auto-expiry** — hourly cleanup via Cloudflare Cron Triggers

## Self-Hosting

```bash
git clone https://github.com/opsyhq/cloak
cd cloak
bun install

# Create D1 database
bunx wrangler d1 create cloak-db
# Copy database_id into wrangler.toml

# Apply schema
bun run db:init

# Dev
bun run dev

# Deploy
bun run deploy
```

Set your custom domain in `wrangler.toml`:
```toml
[vars]
BASE_URL = "https://secrets.yourdomain.com"
```

---

<p align="center">
  Built by <a href="https://github.com/opsyhq"><strong>OpsyHQ</strong></a> · Apache-2.0 License
</p>
