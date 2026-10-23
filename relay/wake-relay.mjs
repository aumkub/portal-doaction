// Wake relay: forwards the portal's signed wake call to a client site from a
// normal server, because Cloudflare zones with bot protection refuse requests
// that come from a Cloudflare Worker (HTTP 403).
//
// It only forwards to https://<public host>/?rest_route=/doaction-care/v1/wake,
// so it cannot be used as an open proxy. The site still verifies the portal's
// own HMAC signature; the relay never sees a site secret.
//
// Run: RELAY_SECRET=... PORT=8787 node wake-relay.mjs   (Node 18+, no dependencies)
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const SECRET = process.env.RELAY_SECRET;
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1"; // 0.0.0.0 inside a container
if (!SECRET || SECRET.length < 32) throw new Error("RELAY_SECRET (32+ chars) is required");

const WAKE_ROUTE = "/doaction-care/v1/wake";
const FORWARD_HEADERS = ["x-da-site", "x-da-timestamp", "x-da-nonce", "x-da-signature"];

function isPrivate(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function send(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/wake") return send(res, 404, { error: "not_found" });
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 8192) return send(res, 413, { error: "too_large" });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks);

  // Portal → relay auth: HMAC of "<ts>.<body>", fresh within 2 minutes.
  const ts = Number(req.headers["x-relay-ts"]);
  const sig = Buffer.from(String(req.headers["x-relay-signature"] ?? ""), "hex");
  const want = createHmac("sha256", SECRET).update(`${ts}.`).update(raw).digest();
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 120 || sig.length !== want.length || !timingSafeEqual(sig, want)) {
    return send(res, 401, { error: "unauthorized" });
  }

  let job;
  try { job = JSON.parse(raw.toString("utf8")); } catch { return send(res, 400, { error: "bad_json" }); }
  let url;
  try { url = new URL(job.url); } catch { return send(res, 400, { error: "bad_url" }); }
  if (url.protocol !== "https:" || url.port || url.username || url.searchParams.get("rest_route") !== WAKE_ROUTE) {
    return send(res, 400, { error: "url_not_allowed" });
  }
  try {
    const addrs = await lookup(url.hostname, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivate(a.address))) return send(res, 400, { error: "host_not_allowed" });
  } catch {
    return send(res, 502, { error: "dns_failed" });
  }

  const headers = { "content-type": "application/json", "user-agent": "DoActionCare-Relay/1.0" };
  for (const h of FORWARD_HEADERS) if (typeof job.headers?.[h] === "string") headers[h] = job.headers[h];
  try {
    const r = await fetch(url, {
      method: "POST", redirect: "manual", headers, body: String(job.body ?? ""),
      signal: AbortSignal.timeout(25_000),
    });
    const text = (await r.text().catch(() => "")).slice(0, 2000);
    send(res, 200, { status: r.status, mitigated: r.headers.get("cf-mitigated"), body: text });
  } catch (e) {
    send(res, 200, { status: 0, error: e?.name === "TimeoutError" ? "timeout" : "connect_failed" });
  }
}).listen(PORT, HOST, () => console.log(`wake relay on ${HOST}:${PORT}`));
