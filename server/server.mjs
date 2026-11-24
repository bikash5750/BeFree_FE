// Minimal, dependency-free Node server:
//   GET  /, /style.css, /script.js  -> the website
//   POST /api/enquiry               -> validate, then write to Zoho CRM
//
// Run:  npm start   (reads .env via `node --env-file`)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateEnquiry } from "./validate.mjs";
import { loadConfig, createZohoClient, processEnquiry } from "./zoho-crm.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ""; // set only if the site is hosted on a different origin
const MAX_BODY_BYTES = 10 * 1024;

// Only these files are served. Nothing else in the project (e.g. .env) is reachable.
const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/script.js": ["script.js", "text/javascript; charset=utf-8"],
  "/thank-you.html": ["thank-you.html", "text/html; charset=utf-8"],
};

const cfg = loadConfig();
const zoho = cfg.missing.length ? null : createZohoClient(cfg);
if (!zoho) console.warn(`[enquiry] Zoho not configured. Missing: ${cfg.missing.join(", ")}. Submissions will return 503.`);

/* Simple in-memory rate limit: 5 submissions per IP per 10 minutes. */
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 5;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(ip);
}, WINDOW_MS).unref();

function send(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("bad json"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

async function handleEnquiry(req, res, corsHeaders) {
  if (!(req.headers["content-type"] || "").includes("application/json")) {
    return send(res, 415, { ok: false, error: "unsupported_media_type" }, corsHeaders);
  }
  const ip = req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) return send(res, 429, { ok: false, error: "rate_limited" }, corsHeaders);

  let body;
  try { body = await readJson(req); }
  catch (err) { return send(res, err.status || 400, { ok: false, error: "invalid_body" }, corsHeaders); }

  // Honeypot filled: reject without touching the CRM. The real form never sends this.
  if (typeof body.website === "string" && body.website.trim()) {
    return send(res, 400, { ok: false, error: "rejected" }, corsHeaders);
  }

  const check = validateEnquiry(body);
  if (!check.ok) return send(res, 400, { ok: false, errors: check.errors }, corsHeaders);

  if (!zoho) return send(res, 503, { ok: false, error: "crm_not_configured" }, corsHeaders);

  try {
    const outcome = await processEnquiry(zoho, cfg, check.value);
    console.info("[enquiry] saved", JSON.stringify(outcome)); // record IDs only, no personal data
    return send(res, 200, { ok: true }, corsHeaders);
  } catch (err) {
    console.error("[enquiry] CRM write failed:", err.name, err.status, err.code, JSON.stringify(err.details || {}));
    return send(res, 502, { ok: false, error: "crm_error" }, corsHeaders);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const corsHeaders = ALLOWED_ORIGIN && req.headers.origin === ALLOWED_ORIGIN
    ? { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, Vary: "Origin" }
    : {};

  if (url.pathname === "/api/enquiry") {
    if (req.method === "OPTIONS" && corsHeaders["Access-Control-Allow-Origin"]) {
      res.writeHead(204, { ...corsHeaders, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" });
      return res.end();
    }
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
    return handleEnquiry(req, res, corsHeaders);
  }

  const file = STATIC_FILES[url.pathname];
  if (req.method === "GET" && file) {
    try {
      const content = await readFile(path.join(ROOT, file[0]));
      res.writeHead(200, { "Content-Type": file[1], "X-Content-Type-Options": "nosniff" });
      return res.end(content);
    } catch {
      res.writeHead(500); return res.end("Server error");
    }
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => console.info(`Befree site on http://localhost:${PORT}`));
