#!/usr/bin/env bun

const CLOAK_URL = process.env.CLOAK_URL || "https://cloak.opsy.sh";

interface ResolverRequest {
  protocolVersion: number;
  provider: string;
  ids: string[];
}

interface ResolverResponse {
  protocolVersion: number;
  values: Record<string, string>;
  errors?: Record<string, string>;
}

async function main(): Promise<void> {
  const chunks: Uint8Array[] = [];
  const reader = Bun.stdin.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const input: ResolverRequest = JSON.parse(Buffer.concat(chunks).toString());

  if (input.protocolVersion !== 1) {
    throw new Error(`Unsupported protocol version: ${input.protocolVersion}`);
  }

  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};

  const results = await Promise.allSettled(
    input.ids.map(async (idWithKey) => {
      const hashIndex = idWithKey.indexOf("#");
      if (hashIndex === -1) {
        throw new Error(`Invalid format: "${idWithKey}". Expected "secretId#encryptionKey"`);
      }

      const id = idWithKey.slice(0, hashIndex);
      const key = idWithKey.slice(hashIndex + 1);

      const res = await fetch(`${CLOAK_URL}/api/secrets/${id}`, {
        headers: { "X-Cloak-Key": key },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error: string }).error);
      }

      const data = (await res.json()) as { secret: string };
      return { idWithKey, secret: data.secret };
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      values[result.value.idWithKey] = result.value.secret;
    } else {
      const idx = results.indexOf(result);
      errors[input.ids[idx]] = result.reason?.message || "Unknown error";
    }
  }

  const response: ResolverResponse = {
    protocolVersion: 1,
    values,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };

  process.stdout.write(JSON.stringify(response));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
