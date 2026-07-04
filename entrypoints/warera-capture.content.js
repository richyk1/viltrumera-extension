// ISOLATED-world coordinator for in-game API capture. Receives the tRPC calls
// the MAIN-world patch (warera-capture-main.content.js) observes, and forwards
// them to the background worker — but ONLY when the user has opted in via the
// popup toggle (browser.storage.local.telemetryEnabled, off by default). When
// the toggle is off, nothing leaves the page.
//
// Client-side dedup by (procedure, batch, input-shape) keeps forwarding bounded:
// each distinct endpoint shape is sent once per page session; the backend does
// the authoritative recursive dedup.
export default defineContentScript({
  matches: ["https://*.warera.io/*", "https://warera.io/*"],
  runAt: "document_start",
  main() {
    const SOURCE = "viltrumera-capture";
    const FLUSH_MS = 4000;
    const FLUSH_AT = 25;

    let enabled = false;
    let buffer = [];
    let flushTimer = null;
    const seen = new Set();

    // Structural signature of a JSON value — mirrors the backend's json_shape so
    // the client dedup and the server catalog agree on "distinct endpoint".
    function jsonShape(v) {
      if (v === null || v === undefined) return "null";
      if (typeof v === "boolean") return "bool";
      if (typeof v === "number") return "number";
      if (typeof v === "string") return "string";
      if (Array.isArray(v)) return v.length ? `[${jsonShape(v[0])}]` : "[]";
      if (typeof v === "object") {
        const keys = Object.keys(v).sort();
        return `{${keys.map((k) => `${k}:${jsonShape(v[k])}`).join(",")}}`;
      }
      return "null";
    }

    async function readToggle() {
      try {
        const { telemetryEnabled } = await browser.storage.local.get("telemetryEnabled");
        enabled = telemetryEnabled === true;
      } catch {
        enabled = false;
      }
    }
    readToggle();

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.telemetryEnabled) return;
      enabled = changes.telemetryEnabled.newValue === true;
      if (!enabled) buffer = [];
    });

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, FLUSH_MS);
    }
    function flush() {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!enabled || buffer.length === 0) { buffer = []; return; }
      const calls = buffer.splice(0, buffer.length);
      browser.runtime.sendMessage({ type: "CAPTURE_CALLS", calls }).catch(() => {});
    }

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      if (event.data?.source !== SOURCE) return;
      if (!enabled) return;
      const call = event.data.call;
      if (!call || !call.procedure) return;
      const key = `${call.procedure}|${call.is_batch}|${jsonShape(call.input)}`;
      if (seen.has(key)) return;
      seen.add(key);
      buffer.push(call);
      if (buffer.length >= FLUSH_AT) flush();
      else scheduleFlush();
    });

    // Flush a partial buffer when the tab is hidden/unloaded.
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  },
});
