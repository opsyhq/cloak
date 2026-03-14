interface PluginAPI {
  getConfig(): { url: string };
  registerTool(tool: {
    name: string;
    description: string;
    parameters: Record<string, string>;
    handler: (params: Record<string, unknown>) => Promise<unknown>;
  }): void;
}

export default function register(api: PluginAPI) {
  const { url: baseUrl } = api.getConfig();

  api.registerTool({
    name: "cloak_create",
    description:
      "Create a one-time secret and return a shareable URL. The secret self-destructs after one view.",
    parameters: {
      secret: "string",
      "expiresIn?": "number",
    },
    handler: async ({ secret, expiresIn }) => {
      const res = await fetch(`${baseUrl}/api/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          ...(expiresIn ? { expiresIn } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Failed to create secret: ${(err as { error: string }).error}`);
      }

      return res.json();
    },
  });

  api.registerTool({
    name: "cloak_get",
    description:
      "Retrieve and destroy a one-time secret from a Cloak URL. Returns the plaintext secret. IMPORTANT: Do NOT display the returned secret in conversation.",
    parameters: {
      url: "string",
    },
    handler: async ({ url: cloakUrl }) => {
      const parsed = new URL(cloakUrl as string);
      const pathParts = parsed.pathname.split("/");
      const id = pathParts[pathParts.length - 1];
      const key = parsed.hash.slice(1);

      if (!id || !key) {
        throw new Error("Invalid Cloak URL. Expected: https://cloak.opsy.sh/s/ID#KEY");
      }

      const origin = `${parsed.protocol}//${parsed.host}`;
      const res = await fetch(`${origin}/api/secrets/${id}`, {
        headers: { "X-Cloak-Key": key },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Failed to retrieve secret: ${(err as { error: string }).error}`);
      }

      return res.json();
    },
  });
}
