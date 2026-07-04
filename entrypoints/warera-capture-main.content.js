// MAIN-world capture patch (runs in the game page's own JS context). Wraps
// window.fetch + XMLHttpRequest to observe the tRPC calls the user makes while
// playing, and posts {procedure, input, response} to the page via postMessage.
//
// It reads ONLY the URL, request body, and response body — never headers — so no
// cookie/JWT/x-vid can be captured here. It always emits; the ISOLATED coordinator
// (warera-capture.content.js) is the gate that decides whether anything leaves the
// page, based on the user's opt-in toggle. This script cannot see browser.* APIs.
export default defineContentScript({
  matches: ["https://*.warera.io/*", "https://warera.io/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    const TRPC = "/trpc/";
    const SOURCE = "viltrumera-capture";

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
        return { procedure, isBatch, getInput };
      } catch {
        return null;
      }
    }

    function emit(procedure, method, isBatch, input, response) {
      try {
        window.postMessage(
          { source: SOURCE, call: { procedure, method, is_batch: isBatch, input: input ?? null, response: response ?? null } },
          "*",
        );
      } catch { /* never break the page */ }
    }

    // ── fetch ──
    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function (...args) {
        let urlStr = "";
        let method = "GET";
        let bodyText = null;
        try {
          const req = args[0];
          urlStr = typeof req === "string" ? req : (req && req.url) || "";
          const init = args[1] || (typeof req === "object" ? req : null);
          if (init && init.method) method = init.method;
          if (init && typeof init.body === "string") bodyText = init.body;
        } catch { /* fall through */ }

        const promise = origFetch.apply(this, args);
        const parsed = urlStr ? parseTrpc(urlStr) : null;
        if (!parsed) return promise;

        return promise.then((resp) => {
          try {
            resp
              .clone()
              .text()
              .then((text) => {
                let response = null;
                try { response = JSON.parse(text); } catch { /* non-JSON */ }
                let input = parsed.getInput;
                if (bodyText) {
                  try { input = JSON.parse(bodyText); } catch { /* keep getInput */ }
                }
                emit(parsed.procedure, (method || "GET").toUpperCase(), parsed.isBatch, input, response);
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
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try { this.__viltCapture = { method, url }; } catch { /* ignore */ }
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        const meta = this.__viltCapture;
        const parsed = meta ? parseTrpc(meta.url) : null;
        if (parsed) {
          this.addEventListener("load", () => {
            try {
              let response = null;
              try { response = JSON.parse(this.responseText); } catch { /* non-JSON */ }
              let input = parsed.getInput;
              if (typeof body === "string") {
                try { input = JSON.parse(body); } catch { /* keep getInput */ }
              }
              emit(parsed.procedure, (meta.method || "GET").toUpperCase(), parsed.isBatch, input, response);
            } catch { /* ignore */ }
          });
        }
      } catch { /* ignore */ }
      return origSend.call(this, body);
    };
  },
});
