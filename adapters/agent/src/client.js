import fs from "node:fs";
import path from "node:path";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const LANGUAGES = ["en", "ko", "zh-Hans", "vi"];
// This build authenticates one shared account and rejects every other name,
// so a SCOPEWEAVER_USERNAME left over from a multi-account backend fails as an
// ordinary "invalid username or password" and reads as a wrong password.
const DEFAULT_USERNAME = "ARTEX";

function noLineBreaks(name, value) {
  if (/[\r\n]/.test(value)) throw new Error(`${name} must not contain line breaks.`);
  return value;
}

export function configFromEnv(env = process.env) {
  const baseURL = new URL(env.SCOPEWEAVER_URL || "http://127.0.0.1:8787");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(baseURL.hostname);
  if ((baseURL.protocol !== "https:" && !(baseURL.protocol === "http:" && loopback)) ||
      baseURL.username || baseURL.password || baseURL.search || baseURL.hash || baseURL.pathname !== "/") {
    throw new Error("SCOPEWEAVER_URL must be an HTTPS origin or a loopback HTTP origin, without credentials or a path.");
  }
  const language = env.SCOPEWEAVER_LANGUAGE || "en";
  if (!LANGUAGES.includes(language)) throw new Error(`SCOPEWEAVER_LANGUAGE must be one of ${LANGUAGES.join(", ")}.`);
  const timeoutMs = Number(env.SCOPEWEAVER_TIMEOUT_MS || 30000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error("SCOPEWEAVER_TIMEOUT_MS must be an integer from 1 to 120000.");
  }
  const token = noLineBreaks("SCOPEWEAVER_TOKEN", env.SCOPEWEAVER_TOKEN || "");
  if (env.SCOPEWEAVER_ALLOW_WRITES && !["true", "false"].includes(env.SCOPEWEAVER_ALLOW_WRITES)) {
    throw new Error("SCOPEWEAVER_ALLOW_WRITES must be true or false.");
  }
  // Kept configurable so the same adapter works against a backend that has
  // named accounts; this build accepts DEFAULT_USERNAME only.
  const username = (env.SCOPEWEAVER_USERNAME || DEFAULT_USERNAME).trim();
  if (!/^[A-Za-z0-9._@-]{3,64}$/.test(username)) {
    throw new Error("SCOPEWEAVER_USERNAME must be 3-64 characters: letters, digits, dot, underscore, hyphen or @.");
  }
  // Cloudflare Access service token, for instances published behind Access.
  const cfId = noLineBreaks("SCOPEWEAVER_CF_ACCESS_CLIENT_ID", (env.SCOPEWEAVER_CF_ACCESS_CLIENT_ID || "").trim());
  const cfSecret = noLineBreaks("SCOPEWEAVER_CF_ACCESS_CLIENT_SECRET", (env.SCOPEWEAVER_CF_ACCESS_CLIENT_SECRET || "").trim());
  if (Boolean(cfId) !== Boolean(cfSecret)) {
    throw new Error("Set both SCOPEWEAVER_CF_ACCESS_CLIENT_ID and SCOPEWEAVER_CF_ACCESS_CLIENT_SECRET, or neither.");
  }
  if (cfId && baseURL.protocol !== "https:") throw new Error("Cloudflare Access credentials require an HTTPS SCOPEWEAVER_URL.");
  const exportDir = path.resolve(env.SCOPEWEAVER_EXPORT_DIR || path.join(process.cwd(), "scopeweaver-export"));
  return { baseURL, language, timeoutMs, token, password: env.SCOPEWEAVER_PASSWORD || "", username,
    cfAccess: cfId ? { id: cfId, secret: cfSecret } : null, exportDir,
    allowWrites: env.SCOPEWEAVER_ALLOW_WRITES === "true" };
}

function safeFilename(name, fallback) {
  const base = path.basename(String(name || "")).replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return base && base.length <= 120 ? base : fallback;
}

export class ScopeWeaverClient {
  constructor(config = configFromEnv()) {
    this.config = config;
    this.token = config.token;
    this.login = null;
  }

  redact(message) {
    for (const secret of [this.token, this.config.token, this.config.password, this.config.cfAccess?.secret]) {
      if (secret) message = message.replaceAll(secret, "[redacted]");
    }
    return message;
  }

  async authenticate(signal) {
    if (this.token) return;
    if (!this.config.password) throw new Error("Set SCOPEWEAVER_TOKEN or SCOPEWEAVER_PASSWORD to authenticate.");
    // Share a single login when an agent calls multiple read tools concurrently.
    if (!this.login) {
      this.login = this.request("/api/auth/login", {
        method: "POST", body: { username: this.config.username, password: this.config.password }, auth: false, signal,
      }).then((result) => {
        if (typeof result.token !== "string" || !result.token) throw new Error("ScopeWeaver login did not return a token.");
        this.token = result.token;
      }).catch((error) => {
        // Name the likely cause: the backend answers a rejected name and a
        // rejected password with the same 401, so an unset-and-forgotten
        // SCOPEWEAVER_USERNAME otherwise sends the user hunting the password.
        if (/HTTP 401/.test(error.message) && this.config.username !== DEFAULT_USERNAME) {
          throw new Error(`${error.message} This backend may accept the ${DEFAULT_USERNAME} account only, and SCOPEWEAVER_USERNAME is set to ${JSON.stringify(this.config.username)}: unset it, or set it to ${DEFAULT_USERNAME}.`);
        }
        throw error;
      }).finally(() => { this.login = null; });
    }
    await this.login;
  }

  headers(auth, hasBody, accept = "application/json") {
    return {
      "Accept": accept, "Accept-Language": this.config.language,
      ...(this.config.cfAccess ? { "CF-Access-Client-Id": this.config.cfAccess.id, "CF-Access-Client-Secret": this.config.cfAccess.secret } : {}),
      ...(auth ? { "Authorization": `Bearer ${this.token}` } : {}),
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    };
  }

  // Redirects are never followed, so credentials cannot reach another server.
  // A redirect from an Access-protected hostname usually means its login page.
  async send(url, init, signal) {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(url, { ...init, redirect: "manual", signal: combined });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const access = this.config.cfAccess ? "Check the service token and that the Access application has a Service Auth policy for it." :
          "If the instance is behind Cloudflare Access, set SCOPEWEAVER_CF_ACCESS_CLIENT_ID and SCOPEWEAVER_CF_ACCESS_CLIENT_SECRET.";
        throw new Error(`ScopeWeaver redirected the request (HTTP ${response.status}); redirects are not followed. ${access}`);
      }
      return { response, combined };
    } catch (error) {
      if (combined.aborted) throw new Error(signal?.aborted ? "ScopeWeaver request cancelled." : "ScopeWeaver request timed out; check task status before retrying a write.");
      throw new Error(this.redact(error.message));
    }
  }

  url(apiPath, query) {
    if (!apiPath.startsWith("/api/")) throw new Error("Only ScopeWeaver API requests are supported.");
    const url = new URL(apiPath, this.config.baseURL);
    if (url.origin !== this.config.baseURL.origin) throw new Error("API requests must stay on the configured origin.");
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  async request(apiPath, { method = "GET", body, query = {}, auth = true, signal } = {}) {
    const url = this.url(apiPath, query);
    if (auth) await this.authenticate(signal);
    const { response, combined } = await this.send(url, {
      method, headers: this.headers(auth, body !== undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }, signal);
    try {
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_RESPONSE_BYTES) throw new Error("ScopeWeaver response exceeds 2 MiB; narrow the query.");
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel(); }
      let result;
      try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new Error(`ScopeWeaver returned a non-JSON response (HTTP ${response.status}).`); }
      if (!response.ok) {
        const hint = response.status === 401 ? " Sign in again or replace the expired token." : "";
        const detail = typeof result?.error === "string" ? this.redact(result.error).slice(0, 500) : "Request failed";
        throw new Error(`ScopeWeaver HTTP ${response.status}: ${detail}.${hint}`);
      }
      return result;
    } catch (error) {
      if (combined.aborted) throw new Error(signal?.aborted ? "ScopeWeaver request cancelled." : "ScopeWeaver request timed out; check task status before retrying a write.");
      throw new Error(this.redact(error.message));
    }
  }

  // Stream a file response into exportDir. Never overwrites an existing file.
  async download(apiPath, { query = {}, fallbackName = "download.bin", signal } = {}) {
    const url = this.url(apiPath, query);
    await this.authenticate(signal);
    const { response, combined } = await this.send(url, { method: "GET", headers: this.headers(true, false, "*/*") }, signal);
    if (!response.ok) {
      let detail = "Request failed";
      try {
        const body = await response.json();
        if (typeof body?.error === "string") detail = this.redact(body.error).slice(0, 500);
      } catch { /* not JSON */ }
      throw new Error(`ScopeWeaver HTTP ${response.status}: ${detail}.`);
    }
    const disposition = response.headers.get("content-disposition") || "";
    const name = safeFilename(disposition.match(/filename="?([^";]+)"?/i)?.[1], fallbackName);
    fs.mkdirSync(this.config.exportDir, { recursive: true });
    let target = path.join(this.config.exportDir, name);
    for (let i = 1; fs.existsSync(target); i++) {
      const ext = path.extname(name);
      target = path.join(this.config.exportDir, `${path.basename(name, ext)}-${i}${ext}`);
    }
    if (path.dirname(target) !== this.config.exportDir) throw new Error("Export path escaped SCOPEWEAVER_EXPORT_DIR.");
    const out = fs.openSync(target, "wx", 0o600);
    let bytes = 0;
    try {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_DOWNLOAD_BYTES) throw new Error("Export exceeds 512 MiB; narrow the filters.");
          fs.writeSync(out, value);
        }
      } finally { await reader.cancel(); }
    } catch (error) {
      fs.closeSync(out);
      fs.rmSync(target, { force: true });
      if (combined.aborted) throw new Error(signal?.aborted ? "ScopeWeaver request cancelled." : "ScopeWeaver export timed out; raise SCOPEWEAVER_TIMEOUT_MS or narrow the filters.");
      throw new Error(this.redact(error.message));
    }
    fs.closeSync(out);
    return { file: target, bytes, content_type: response.headers.get("content-type") || "" };
  }
}
