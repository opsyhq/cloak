#!/usr/bin/env bun

const CLOAK_URL = process.env.CLOAK_URL || "https://cloak.opsy.sh";

async function create(ttl?: string): Promise<void> {
  const chunks: Uint8Array[] = [];
  const reader = Bun.stdin.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const secret = Buffer.concat(chunks).toString().trimEnd();

  if (!secret) {
    console.error("Error: no secret provided. Pipe your secret via stdin:");
    console.error('  echo "$SECRET" | cloak create');
    process.exit(1);
  }

  const expiresIn = parseTTL(ttl);

  const res = await fetch(`${CLOAK_URL}/api/secrets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, ...(expiresIn ? { expiresIn } : {}) }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  const data = (await res.json()) as { url: string };
  console.log(data.url);
}

async function get(url: string, asEnv: boolean): Promise<void> {
  const parsed = new URL(url);
  const pathParts = parsed.pathname.split("/");
  const id = pathParts[pathParts.length - 1];
  const key = parsed.hash.slice(1);

  if (!id || !key) {
    console.error("Error: invalid cloak URL. Expected format: https://cloak.opsy.sh/s/ID#KEY");
    process.exit(1);
  }

  const baseUrl = `${parsed.protocol}//${parsed.host}`;

  // Use X-Cloak-Key header (not query param) to avoid logging
  const res = await fetch(`${baseUrl}/api/secrets/${id}`, {
    headers: { "X-Cloak-Key": key },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  const data = (await res.json()) as { secret: string };

  if (asEnv) {
    console.log(`export SECRET=${shellEscape(data.secret)}`);
  } else {
    process.stdout.write(data.secret);
  }
}

function parseTTL(ttl?: string): number | undefined {
  if (!ttl) return undefined;
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    console.error("Error: invalid TTL format. Use e.g. 1h, 30m, 7d");
    process.exit(1);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[unit];
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

const args = process.argv.slice(2);
const command = args[0];

if (command === "create") {
  const ttlIndex = args.indexOf("--ttl");
  const ttl = ttlIndex !== -1 ? args[ttlIndex + 1] : undefined;
  await create(ttl);
} else if (command === "get") {
  const url = args[1];
  if (!url) {
    console.error("Usage: cloak get <url> [--env]");
    process.exit(1);
  }
  const asEnv = args.includes("--env");
  await get(url, asEnv);
} else {
  console.log(`Cloak — One-time secret sharing

Usage:
  echo "secret" | cloak create [--ttl 1h]    Create a secret, output the URL
  cloak get <url>                             Retrieve and print the secret
  cloak get <url> --env                       Print as: export SECRET='...'

Environment:
  CLOAK_URL    Base URL (default: https://cloak.opsy.sh)`);
}
