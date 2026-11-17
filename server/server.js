// AgeCheck Study: reference server.
//
// Node built-ins only (no npm dependencies). It does two things:
//   1. Serves the static app (index.html, researcher.html, styles.css, src/).
//   2. In research mode with a remote endpoint, accepts validated record
//      submissions and gives the researcher authenticated access to them.
//      It accepts nothing until a valid research configuration has been
//      deployed to it, and it applies the same rules as the browser's stores
//      when a record arrives twice or out of order: newer progress wins, a
//      late save never undoes it, and a withdrawal replaces everything.
//
// Secrets come from environment variables and never reach the frontend:
//   AGECHECK_SUBMIT_TOKEN   shared token participants' browsers send with a
//                           submission (it allows writing, never reading)
//   AGECHECK_ADMIN_TOKEN    researcher token for listing, deleting, and
//                           setting the configuration
//   AGECHECK_DATA_DIR       where records.json and config.json live
//                           (default server/data, gitignored)
//   AGECHECK_ALLOWED_ORIGIN optional CORS origin when the static app is
//                           hosted elsewhere (default: same origin only)
//   HOST, PORT              default 127.0.0.1:8080
//
// Logging: method, path, status, and duration only. Request bodies, answers,
// recruitment codes, and client addresses are never logged by this server.
// Your hosting provider or reverse proxy may still log IP addresses; check
// that before promising anonymity.

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { validateRecord, resolveSave } from "../src/data-dictionary.js";
import { activationProblems, validateConfig, parseConfig, retainsPartialResponses, DEFAULT_STUDY_CONFIG } from "../src/study-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const STATIC_ALLOW = [/^\/index\.html$/, /^\/researcher\.html$/, /^\/styles\.css$/, /^\/src\/[A-Za-z0-9_-]+\.js$/, /^\/favicon\.ico$/];

export function createApp(options = {}) {
  const submitToken = options.submitToken ?? process.env.AGECHECK_SUBMIT_TOKEN ?? "";
  const adminToken = options.adminToken ?? process.env.AGECHECK_ADMIN_TOKEN ?? "";
  const dataDir = path.resolve(options.dataDir ?? process.env.AGECHECK_DATA_DIR ?? path.join(__dirname, "data"));
  const allowedOrigin = options.allowedOrigin ?? process.env.AGECHECK_ALLOWED_ORIGIN ?? "";
  const log = options.log ?? ((line) => process.stdout.write(line + "\n"));
  const maxBody = 32 * 1024;
  const rate = new Map(); // in-memory only, never persisted or logged

  fs.mkdirSync(dataDir, { recursive: true });
  const recordsFile = path.join(dataDir, "records.json");
  const configFile = path.join(dataDir, "config.json");
  let writing = Promise.resolve();

  function timingSafeEqual(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ab.length !== bb.length || ab.length === 0) return false;
    return crypto.timingSafeEqual(ab, bb);
  }

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  /** The stored records. A file that exists but cannot be read is an error, never "no records". */
  async function readRecords() {
    let text;
    try {
      text = await fsp.readFile(recordsFile, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return {};
      throw new Error("records unreadable");
    }
    try {
      const map = JSON.parse(text);
      if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("shape");
      return map;
    } catch {
      throw new Error("records unreadable");
    }
  }

  /**
   * The configuration deployed to this server, checked every time it is used.
   * Returns { present, config, problems }.
   */
  async function deployedConfig() {
    const raw = await readJson(configFile, null);
    if (!raw) return { present: false, config: null, problems: ["No configuration is deployed."] };
    const parsed = parseConfig(raw);
    return { present: true, config: parsed.config, problems: parsed.problems };
  }

  async function writeJsonAtomic(file, value) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, file);
  }

  /** Serialize record writes so concurrent submissions cannot clobber each other. */
  function withRecords(fn) {
    const run = writing.then(async () => {
      const map = await readRecords();
      const result = await fn(map);
      if (result && result.write) await writeJsonAtomic(recordsFile, map);
      return result ? result.value : undefined;
    });
    writing = run.catch(() => {});
    return run;
  }

  function send(res, status, body, headers = {}) {
    const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json; charset=utf-8" : headers["Content-Type"] || "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(payload);
  }

  function securityHeaders(res, origin) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' " +
        (allowedOrigin ? allowedOrigin : "") +
        "; frame-ancestors 'none'; form-action 'self'; base-uri 'self'"
    );
    if (allowedOrigin && origin === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Study-Token, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Vary", "Origin");
    }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers["content-length"] || 0);
      if (declared > maxBody) {
        // Refuse up front; drain so the client receives the 413 cleanly.
        req.resume();
        reject(new Error("too large"));
        return;
      }
      let size = 0;
      let rejected = false;
      const chunks = [];
      req.on("data", (c) => {
        if (rejected) return;
        size += c.length;
        if (size > maxBody) {
          rejected = true;
          chunks.length = 0;
          reject(new Error("too large"));
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (!rejected) resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", reject);
    });
  }

  function rateLimited(req) {
    // Per-address counter kept only in memory for one minute.
    const key = req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = rate.get(key) || { start: now, count: 0 };
    if (now - entry.start > 60_000) {
      entry.start = now;
      entry.count = 0;
    }
    entry.count += 1;
    rate.set(key, entry);
    if (rate.size > 5000) rate.clear();
    return entry.count > 120;
  }

  function isAdmin(req) {
    if (!adminToken) return false;
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    return Boolean(m) && timingSafeEqual(m[1].trim(), adminToken);
  }

  async function handleSubmit(req, res) {
    if (!submitToken) return send(res, 503, { error: "Collection is not configured on this server (no submit token)." });
    if (rateLimited(req)) return send(res, 429, { error: "Too many requests. Wait a minute and try again." });
    if (!timingSafeEqual(req.headers["x-study-token"] || "", submitToken)) {
      return send(res, 401, { error: "This submission was not accepted (invalid study token)." });
    }
    // Nothing is accepted until a valid research configuration is deployed here.
    const deployed = await deployedConfig();
    if (!deployed.present) {
      return send(res, 503, { error: "This server is not accepting records: no study configuration has been deployed to it." });
    }
    if (!deployed.config || deployed.config.mode !== "research" || deployed.problems.length) {
      return send(res, 503, { error: "This server is not accepting records: the deployed configuration is not a valid research configuration." });
    }
    let record;
    try {
      record = JSON.parse(await readBody(req));
    } catch (err) {
      if (err && err.message === "too large") throw err;
      return send(res, 400, { error: "The submission could not be read." });
    }
    const problems = validateRecord(record);
    if (record && record.record_kind !== "research") problems.push("record_kind must be research");
    if (problems.length) return send(res, 422, { error: "The submission did not match the data dictionary.", problems: problems.slice(0, 10) });
    if (record.study_version !== deployed.config.studyVersion) {
      return send(res, 409, { error: `Study version mismatch (server is on ${deployed.config.studyVersion}).` });
    }
    // The same rule as the browser's stores: newer progress replaces older, a
    // late save never undoes it, and a withdrawal replaces everything. The
    // deployed retention policy is applied to every withdrawn record here, so
    // it holds whatever the sending browser did.
    const retainWithdrawn = retainsPartialResponses(deployed.config);
    const outcome = await withRecords(async (map) => {
      const decision = resolveSave(map[record.response_id], record, { retainWithdrawn });
      const write = decision.outcome === "created" || decision.outcome === "updated";
      if (write) map[record.response_id] = decision.record;
      return { write, value: { ok: true, outcome: decision.outcome, duplicate: decision.outcome !== "created" } };
    });
    return send(res, 200, outcome);
  }

  async function handleAdmin(req, res, pathname) {
    if (!adminToken) return send(res, 503, { error: "Administration is not configured on this server (no admin token)." });
    if (!isAdmin(req)) return send(res, 401, { error: "Unauthorized." });

    if (pathname === "/api/admin/records" && req.method === "GET") {
      const map = await readRecords();
      return send(res, 200, { records: Object.values(map) });
    }
    const del = pathname.match(/^\/api\/admin\/records\/([A-Z2-9]{4}-[A-Z2-9]{4})$/);
    if (del && req.method === "DELETE") {
      const code = del[1];
      const removed = await withRecords(async (map) => {
        let n = 0;
        for (const [id, rec] of Object.entries(map)) {
          if (rec.response_code === code) {
            delete map[id];
            n += 1;
          }
        }
        return { write: n > 0, value: n };
      });
      return send(res, 200, { removed });
    }
    if (pathname === "/api/admin/config" && req.method === "GET") {
      const cfg = await readJson(configFile, null);
      return send(res, 200, { config: cfg });
    }
    if (pathname === "/api/admin/config" && req.method === "PUT") {
      let parsed;
      try {
        parsed = parseConfig(JSON.parse(await readBody(req)));
      } catch (err) {
        if (err && err.message === "too large") throw err;
        return send(res, 400, { error: "The configuration could not be read." });
      }
      if (!parsed.config) return send(res, 400, { error: "That is not a study configuration.", problems: parsed.problems });
      const cfg = parsed.config;
      const structure = validateConfig(cfg);
      if (structure.length) return send(res, 422, { error: "The configuration is not valid.", problems: structure });
      const map = await readRecords();
      const existing = await deployedConfig();
      const count = Object.keys(map).length;
      if (count > 0 && existing.config && existing.config.mode === "research") {
        return send(res, 409, {
          error: `The configuration is frozen: ${count} research record(s) exist for study version ${existing.config.studyVersion}. Export and remove them, or deploy the new version with a new data directory.`,
        });
      }
      if (cfg.mode === "research") {
        const problems = activationProblems(cfg);
        if (cfg.storage.adapter !== "remote-endpoint") {
          problems.push("A research configuration deployed to this server must use the remote endpoint, or participants' records would never reach it.");
        } else if (!submitToken) {
          problems.push("This server has no AGECHECK_SUBMIT_TOKEN set, so it could not accept records.");
        } else if (!timingSafeEqual(cfg.storage.submitToken || "", submitToken)) {
          problems.push("The submit token in the configuration does not match this server's AGECHECK_SUBMIT_TOKEN, so every submission would be refused.");
        }
        if (problems.length) return send(res, 422, { error: "The configuration is not ready for research mode.", problems });
      }
      await writeJsonAtomic(configFile, cfg);
      return send(res, 200, { ok: true, mode: cfg.mode, studyVersion: cfg.studyVersion });
    }
    return send(res, 404, { error: "Not found." });
  }

  async function handleStatic(req, res, pathname) {
    if (pathname === "/") pathname = "/index.html";
    if (pathname === "/study.config.json") {
      const cfg = await readJson(configFile, null);
      if (!cfg) return send(res, 404, { error: "No configuration deployed." });
      return send(res, 200, cfg);
    }
    if (!STATIC_ALLOW.some((re) => re.test(pathname))) return send(res, 404, "Not found");
    const file = path.join(ROOT, pathname);
    if (!file.startsWith(ROOT + path.sep)) return send(res, 404, "Not found");
    try {
      const data = await fsp.readFile(file);
      return send(res, 200, data, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    } catch {
      return send(res, 404, "Not found");
    }
  }

  return async function handler(req, res) {
    const started = Date.now();
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    securityHeaders(res, req.headers.origin);
    res.on("finish", () => log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`));
    try {
      if (req.method === "OPTIONS") return send(res, 204, "");
      if (pathname === "/api/submit" && req.method === "POST") return await handleSubmit(req, res);
      if (pathname.startsWith("/api/admin/")) return await handleAdmin(req, res, pathname);
      if (pathname.startsWith("/api/")) return send(res, 404, { error: "Not found." });
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
      return await handleStatic(req, res, pathname);
    } catch (err) {
      if (err && err.message === "too large") return send(res, 413, { error: "The submission is too large." });
      if (err && err.message === "records unreadable") {
        return send(res, 500, { error: "The server's record file could not be read, so nothing was changed. The researcher needs to check it." });
      }
      return send(res, 500, { error: "The server could not process the request." });
    }
  };
}

export function startServer(options = {}) {
  const handler = createApp(options);
  const server = http.createServer(handler);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PORT || 8080);
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  startServer().then((server) => {
    const a = server.address();
    const submit = process.env.AGECHECK_SUBMIT_TOKEN ? "set" : "NOT set (submissions disabled)";
    const admin = process.env.AGECHECK_ADMIN_TOKEN ? "set" : "NOT set (admin API disabled)";
    process.stdout.write(`AgeCheck Study server on http://${a.address}:${a.port}\n  submit token: ${submit}\n  admin token: ${admin}\n  data dir: ${process.env.AGECHECK_DATA_DIR || path.join(__dirname, "data")}\n`);
  });
}

export { DEFAULT_STUDY_CONFIG };
