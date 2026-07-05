// MAIN-world capture patch (runs in the game page's own JS context). Wraps
// window.fetch + XMLHttpRequest to observe the tRPC calls the user makes while
// playing, and posts a full-fidelity capture object to the page via postMessage.
//
// It reads the URL, request body, response body, status, timing, and the
// non-auth request + response headers. Auth headers (cookie, authorization,
// x-vid, set-cookie, and anything containing auth/token/jwt/session/secret/
// cookie/vid) are stripped IN-PAGE before anything is emitted, so no credential
// can ever leave this context. It always emits; the ISOLATED coordinator
// (warera-capture.content.js) is the gate that decides whether anything leaves
// the page, based on the user's opt-in toggle. This script cannot see browser.* APIs.
export default defineContentScript({
  matches: ["https://*.warera.io/*", "https://warera.io/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    const TRPC = "/trpc/";
    const SOURCE = "viltrumera-capture";
    const BODY_CAP = 256 * 1024;

    // ── auth strip (security invariant: never emit a credential) ──
    const AUTH_EXACT = ["cookie", "authorization", "set-cookie", "x-vid"];
    const AUTH_SUBSTR = ["auth", "token", "jwt", "session", "secret", "cookie", "vid"];
    function isAuthHeader(name) {
      const k = String(name).toLowerCase();
      if (AUTH_EXACT.includes(k)) return true;
      return AUTH_SUBSTR.some((s) => k.includes(s));
    }
    function stripAuth(headers) {
      const out = {};
      if (!headers) return out;
      for (const k of Object.keys(headers)) {
        if (isAuthHeader(k)) continue;
        out[k] = headers[k];
      }
      return out;
    }

    // Normalize a Headers / [name,value][] / plain object into a lowercase-keyed object.
    function normalizeHeaders(h) {
      const out = {};
      try {
        if (!h) return out;
        if (typeof Headers !== "undefined" && h instanceof Headers) {
          h.forEach((v, k) => { out[String(k).toLowerCase()] = v; });
        } else if (Array.isArray(h)) {
          for (const pair of h) {
            if (pair && pair.length >= 2) out[String(pair[0]).toLowerCase()] = pair[1];
          }
        } else if (typeof h === "object") {
          for (const k of Object.keys(h)) out[String(k).toLowerCase()] = h[k];
        }
      } catch { /* ignore */ }
      return out;
    }

    // Parse the CRLF string from XHR.getAllResponseHeaders() into a lowercase-keyed object.
    function parseXhrHeaders(raw) {
      const out = {};
      if (!raw) return out;
      for (const line of raw.trim().split(/[\r\n]+/)) {
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const k = line.slice(0, idx).trim().toLowerCase();
        if (k) out[k] = line.slice(idx + 1).trim();
      }
      return out;
    }

    // Cap a body string at BODY_CAP chars and try to parse it as JSON.
    // Returns the parsed value (null if non-JSON or truncated past parseability),
    // the true char length, and whether the cap was hit.
    function capAndParse(text) {
      if (typeof text !== "string") return { value: null, bytes: null, truncated: false };
      const bytes = text.length;
      const truncated = bytes > BODY_CAP;
      const slice = truncated ? text.slice(0, BODY_CAP) : text;
      let value = null;
      try { value = JSON.parse(slice); } catch { /* non-JSON or truncated */ }
      return { value, bytes, truncated };
    }

    function parseTrpc(urlStr) {
      try {
        const u = new URL(urlStr, location.href);
        const i = u.pathname.indexOf(TRPC);
        if (i < 0) return null;
        const procedure = decodeURIComponent(u.pathname.slice(i + TRPC.length));
        const isBatch = u.searchParams.get("batch") === "1";
        let getInput = null;
        const raw = u.searchParams.get("input");
        if (raw) {
          try { getInput = JSON.parse(raw); } catch { /* leave null */ }
        }
        return { procedure, isBatch, getInput, url: u.pathname + u.search };
      } catch {
        return null;
      }
    }

    // Assemble + emit a full-fidelity capture. Auth headers are stripped here so
    // no callsite can ever leak a credential to the page.
    function emit(call) {
      try {
        call.req_headers = stripAuth(call.req_headers);
        call.resp_headers = stripAuth(call.resp_headers);
        window.postMessage({ source: SOURCE, call }, "*");
      } catch { /* never break the page */ }
    }

    // ── fetch ──
    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function (...args) {
        let urlStr = "";
        let method = "GET";
        let bodyText = null;
        const reqHeaders = {};
        try {
          const req = args[0];
          const init = args[1];
          const isRequest = req && typeof req === "object" && typeof req.url === "string";
          urlStr = typeof req === "string" ? req : (isRequest ? req.url : "");
          if (isRequest) {
            if (req.method) method = req.method;
            Object.assign(reqHeaders, normalizeHeaders(req.headers));
          }
          if (init) {
            if (init.method) method = init.method;
            if (typeof init.body === "string") bodyText = init.body;
            if (init.headers) Object.assign(reqHeaders, normalizeHeaders(init.headers));
          }
        } catch { /* fall through */ }

        const t0 = performance.now();
        const promise = origFetch.apply(this, args);
        const parsed = urlStr ? parseTrpc(urlStr) : null;
        if (!parsed) return promise;

        return promise.then((resp) => {
          try {
            resp
              .clone()
              .text()
              .then((text) => {
                const duration = Math.round((performance.now() - t0) * 10) / 10;
                const respHeaders = {};
                try {
                  resp.headers.forEach((v, k) => { respHeaders[String(k).toLowerCase()] = v; });
                } catch { /* ignore */ }
                const respBody = capAndParse(text);
                const reqBody = typeof bodyText === "string"
                  ? capAndParse(bodyText)
                  : { value: parsed.getInput, bytes: null, truncated: false };
                const status = typeof resp.status === "number" ? resp.status : null;
                emit({
                  procedure: parsed.procedure,
                  method: (method || "GET").toUpperCase(),
                  is_batch: parsed.isBatch,
                  url: parsed.url,
                  input: reqBody.value,
                  response: respBody.value,
                  status,
                  ok: status != null ? status < 400 : null,
                  status_text: resp.statusText ?? "",
                  duration_ms: duration,
                  client_ts: new Date().toISOString(),
                  req_headers: reqHeaders,
                  resp_headers: respHeaders,
                  response_bytes: respBody.bytes,
                  truncated: respBody.truncated || reqBody.truncated,
                });
              })
              .catch(() => {});
          } catch { /* ignore */ }
          return resp;
        });
      };
    }

    // ── XMLHttpRequest ──
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try { this.__viltCapture = { method, url, headers: {} }; } catch { /* ignore */ }
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      try {
        if (!this.__viltCapture) this.__viltCapture = { headers: {} };
        if (!this.__viltCapture.headers) this.__viltCapture.headers = {};
        const k = String(name).toLowerCase();
        const h = this.__viltCapture.headers;
        h[k] = k in h ? `${h[k]}, ${value}` : String(value);
      } catch { /* ignore */ }
      return origSetHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function (body) {
      try {
        const meta = this.__viltCapture;
        const parsed = meta ? parseTrpc(meta.url) : null;
        if (parsed) {
          const t0 = performance.now();
          this.addEventListener("load", () => {
            try {
              const duration = Math.round((performance.now() - t0) * 10) / 10;
              let respText = null;
              try { respText = this.responseText; } catch { /* non-text responseType */ }
              const respBody = capAndParse(respText);
              const reqBody = typeof body === "string"
                ? capAndParse(body)
                : { value: parsed.getInput, bytes: null, truncated: false };
              const status = typeof this.status === "number" ? this.status : null;
              emit({
                procedure: parsed.procedure,
                method: (meta.method || "GET").toUpperCase(),
                is_batch: parsed.isBatch,
                url: parsed.url,
                input: reqBody.value,
                response: respBody.value,
                status,
                ok: status != null ? status < 400 : null,
                status_text: this.statusText ?? "",
                duration_ms: duration,
                client_ts: new Date().toISOString(),
                req_headers: meta.headers || {},
                resp_headers: parseXhrHeaders(this.getAllResponseHeaders()),
                response_bytes: respBody.bytes,
                truncated: respBody.truncated || reqBody.truncated,
              });
            } catch { /* ignore */ }
          });
        }
      } catch { /* ignore */ }
      return origSend.call(this, body);
    };
  },
});
