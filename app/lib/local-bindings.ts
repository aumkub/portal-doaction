// Mock Cloudflare bindings for local development
// This is used by the Vite dev server when running locally

import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

// Create a local KV namespace mock
class LocalKVNamespace {
  private store: Map<string, { value: string; expiration?: number }>;

  constructor() {
    this.store = new Map();
  }

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiration && Date.now() > item.expiration) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiration = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined;
    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }> {
    const prefix = options?.prefix || "";
    const keys = Array.from(this.store.keys())
      .filter(key => key.startsWith(prefix))
      .map(name => ({ name }));
    return { keys };
  }
}

// Create a local R2 bucket mock
class LocalR2Bucket {
  private store: Map<string, Uint8Array>;

  constructor() {
    this.store = new Map();
  }

  async put(key: string, value: ArrayBuffer | ReadableStream | Uint8Array): Promise<void> {
    if (value instanceof ReadableStream) {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      this.store.set(key, result);
    } else if (value instanceof ArrayBuffer) {
      this.store.set(key, new Uint8Array(value));
    } else {
      this.store.set(key, value);
    }
  }

  async get(key: string): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null> {
    const value = this.store.get(key);
    if (!value) return null;
    return {
      async arrayBuffer() {
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      },
    };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }> {
    const prefix = options?.prefix || "";
    const objects = Array.from(this.store.keys())
      .filter(key => key.startsWith(prefix))
      .map(key => ({ key }));
    return { objects };
  }
}

// Create a local SendEmail mock
class LocalSendEmail {
  async send(params: {
    to: string[];
    from: string;
    subject: string;
    text?: string;
    html?: string;
  }): Promise<void> {
    console.log("[Mock Email] Sent to:", params.to, "Subject:", params.subject);
  }
}

// Create local bindings
export const localBindings = {
  DB: null as any, // Will be initialized separately
  SESSIONPORTAL: new LocalKVNamespace() as KVNamespace,
  ATTACHMENTS: new LocalR2Bucket() as R2Bucket,
  SEND_EMAIL: new LocalSendEmail() as SendEmail,
  APP_URL: "http://localhost:5173",
  SESSION_SECRET: "y8N4vQ2mK7pLx3Rz9tW6cJ1hF5uD0sBa",
  WEBDAV_HOST: "cloud.aumwp.com",
  WEBDAV_USER: "aum",
  WEBDAV_PATH: "/home/Backup",
  WEBDAV_PASS: "test-password",
  VALUE_FROM_CLOUDFLARE: "Hello from Cloudflare",
};