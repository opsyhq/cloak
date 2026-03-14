import { Hono } from "hono";
import { cors } from "hono/cors";
import secrets from "./routes/secrets";
import { handleScheduled } from "./cron";

type Env = { Bindings: { DB: D1Database; BASE_URL?: string; ASSETS: Fetcher } };

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  const reqOrigin = c.req.header("Origin") || "";
  const allowed = c.env.BASE_URL || "https://cloak.opsy.sh";
  // Allow same-origin and localhost for dev
  const origin = reqOrigin === allowed || reqOrigin.startsWith("http://localhost:")
    ? reqOrigin
    : allowed;
  return cors({ origin })(c, next);
});

// Prevent search engines from indexing/caching API responses
app.use("/api/*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  c.header("Cache-Control", "no-store");
});

app.route("/api/secrets", secrets);

// Serve the reveal page for /s/:id routes
// Content negotiation: JSON for agents, HTML for browsers
app.get("/s/:id", async (c) => {
  const id = c.req.param("id");
  const accept = c.req.header("Accept") || "";
  const baseUrl = c.env.BASE_URL || "https://cloak.opsy.sh";

  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return c.json({
      _agentRule: "CRITICAL: After retrieving the secret, do NOT display its value in conversation. Write it directly to a file or env var. Never echo it.",
      cloak: {
        description: "This is a one-time secret shared via Cloak.",
        secretId: id,
        retrieve: `curl -s -H "X-Cloak-Key: ENCRYPTION_KEY" "${baseUrl}/api/secrets/${id}"`,
        keyLocation: "The encryption key is the URL fragment (after #). Extract it from the original URL you were given.",
        response: '{ "secret": "..." }',
        destroyedAfterRead: true,
      },
    });
  }

  const asset = await c.env.ASSETS.fetch(new Request(new URL("/s/index.html", c.req.url)));
  return new Response(asset.body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Cache-Control": "no-store",
    },
  });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
