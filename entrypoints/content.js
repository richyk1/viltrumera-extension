export default defineContentScript({
  matches: ["https://viltrumera.app/*", "http://localhost:5173/*"],
  runAt: "document_idle",

  main() {
    // Wake the background worker, confirm readiness, then identify the user.
    // Identity relayed to the page contains only public info (userId, username) — never the JWT.
    async function startup() {
      try {
        await browser.runtime.sendMessage({ type: "PING" });
        console.log("[Viltrumera] content script connected to background worker");
        window.postMessage({ source: "viltrumera-ext", type: "READY", healthy: true }, "*");
      } catch (err) {
        console.warn("[Viltrumera] background worker not ready:", err.message);
        window.postMessage({ source: "viltrumera-ext", type: "READY", healthy: false }, "*");
        window.postMessage({ source: "viltrumera-ext", type: "IDENTIFIED", userId: null, personalized: false }, "*");
        return;
      }

      try {
        const identity = await browser.runtime.sendMessage({ type: "IDENTIFY" });
        window.postMessage({ source: "viltrumera-ext", type: "IDENTIFIED", ...identity }, "*");
      } catch (err) {
        console.warn("[Viltrumera] identify failed:", err.message);
        window.postMessage({ source: "viltrumera-ext", type: "IDENTIFIED", userId: null, personalized: false }, "*");
      }
    }

    // Re-identify and notify the page when the background syncs (e.g. Sync Now button pressed).
    browser.runtime.onMessage.addListener((message) => {
      if (message.type === "EXTENSION_SYNCED") {
        window.postMessage({ source: "viltrumera-ext", type: "EXTENSION_READY" }, "*");
        // Re-fetch identity so the page gets updated user info after sync.
        browser.runtime.sendMessage({ type: "IDENTIFY" })
          .then((identity) => {
            window.postMessage({ source: "viltrumera-ext", type: "IDENTIFIED", ...identity }, "*");
          })
          .catch((err) => {
            console.warn("[Viltrumera] re-identify after sync failed:", err.message);
          });
      }
    });

    // Bridge: page postMessage → runtime message → page postMessage
    window.addEventListener("message", async (event) => {
      if (event.source !== window) return;
      if (event.data?.source !== "viltrumera") return;

      const { type, requestId } = event.data;
      if (!type || !requestId) return;

      if (!browser.runtime?.id) {
        window.postMessage({
          source: "viltrumera-ext",
          requestId,
          success: false,
          error: "Extension was reloaded — refresh the page",
          code: "UNKNOWN",
        }, "*");
        return;
      }

      try {
        const response = await browser.runtime.sendMessage(event.data);
        window.postMessage({ source: "viltrumera-ext", requestId, ...response }, "*");
      } catch (err) {
        window.postMessage({
          source: "viltrumera-ext",
          requestId,
          success: false,
          error: err.message || "Extension error",
          code: "UNKNOWN",
        }, "*");
      }
    });

    startup();
  },
});
