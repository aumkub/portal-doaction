#!/usr/bin/env node
// Builds, signs and uploads the do action Care plugin.
//   node scripts/release-care-plugin.mjs            → production R2
//   node scripts/release-care-plugin.mjs --local DIR → local dev state (persist dir)
// The Ed25519 private key lives only on the release machine
// (~/.config/doaction-care/signing.key); the plugin ships the public key.
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pluginDir = join(root, "wp-plugin");
const localIdx = process.argv.indexOf("--local");
const persist = localIdx > -1 ? process.argv[localIdx + 1] : null;
const keyPath = process.env.DOACTION_CARE_KEY ?? join(homedir(), ".config/doaction-care/signing.key");

const header = readFileSync(join(pluginDir, "doaction-care/doaction-care.php"), "utf8");
const field = (name) => header.match(new RegExp(`^ \\* ${name}:\\s*(.+)$`, "m"))?.[1].trim();
const version = field("Version");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("plugin Version header missing");
if (!header.includes(`define( 'DOACTION_CARE_VERSION', '${version}' )`)) throw new Error("DOACTION_CARE_VERSION does not match the header");

const out = mkdtempSync(join(tmpdir(), "dacare-"));
const file = `doaction-care-${version}.zip`;
const zipPath = join(out, file);
execFileSync("zip", ["-qrX", zipPath, "doaction-care", "-x", "*.DS_Store"], { cwd: pluginDir });
const zip = readFileSync(zipPath);

const key = createPrivateKey(readFileSync(keyPath));
const sha256 = createHash("sha256").update(zip).digest("hex");
const signature = sign(null, zip, key).toString("base64");
// Binds the version to these exact bytes, so an old signed zip cannot be
// advertised as a newer version (downgrade).
const version_signature = sign(null, Buffer.from(`doaction-care|${version}|${sha256}`), key).toString("base64");
const manifest = {
  version, file, size: zip.length,
  sha256,
  signature,
  version_signature,
  requires_wp: field("Requires at least"), requires_php: field("Requires PHP"),
  released_at: Math.floor(Date.now() / 1000),
};
const manifestPath = join(out, "latest.json");
writeFileSync(manifestPath, JSON.stringify(manifest));

const target = persist ? ["--local", "--persist-to", persist] : ["--remote"];
const put = (key, path, type) =>
  execFileSync("npx", ["wrangler", "r2", "object", "put", `portal/care-plugin/${key}`, "--file", path, "--content-type", type, ...target], { cwd: root, stdio: "inherit" });
put(file, zipPath, "application/zip");
put("latest.json", manifestPath, "application/json");
console.log(`released ${file} (${zip.length} bytes) to ${persist ? "local " + persist : "production"}`);
