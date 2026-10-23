// Cloudflare bindings available in context.cloudflare.env.
// `export {}` makes this file a module, so `declare module "react-router"`
// below augments react-router instead of replacing its types.
export {};

declare global {
interface CloudflareEnv {
  // D1 database
  DB: D1Database;
  // KV namespace for sessions
  SESSIONPORTAL: KVNamespace;
  // Cloudflare Email Routing binding
  SEND_EMAIL: SendEmail;
  // Public URL of the portal (e.g. https://portal.doaction.co.th)
  APP_URL: string;
  // Secret used for HMAC signing (magic link tokens, etc.)
  SESSION_SECRET: string;
  /** Optional wake relay on a normal server (relay/wake-relay.mjs), for sites whose Cloudflare blocks Workers. */
  WAKE_RELAY_URL?: string;
  WAKE_RELAY_SECRET?: string;
  // File attachments bucket
  ATTACHMENTS: R2Bucket;
  // Legacy var from Cloudflare template
  VALUE_FROM_CLOUDFLARE: string;
  // UptimeRobot API key (wrangler secret)
  UPTIMEROBOT_API_KEY?: string;
}
}

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: CloudflareEnv;
      ctx: ExecutionContext;
    };
  }
}
