// Cloudflare bindings available in context.cloudflare.env
interface CloudflareEnv {
  // D1 database
  DB: D1Database;
  // KV namespace for sessions
  SESSIONPORTAL: KVNamespace;
  // SMTP2GO API key for sending emails
  SMTP2GO_API_KEY: string;
  // Public URL of the portal (e.g. https://portal.doaction.co.th)
  APP_URL: string;
  // Secret used for HMAC signing (magic link tokens, etc.)
  SESSION_SECRET: string;
  // File attachments bucket
  ATTACHMENTS: R2Bucket;
  // Legacy var from Cloudflare template
  VALUE_FROM_CLOUDFLARE: string;
}

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: CloudflareEnv;
      ctx: ExecutionContext;
    };
  }
}
