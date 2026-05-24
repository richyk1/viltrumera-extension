// Wake the background service worker, confirm readiness, then identify the user.
// Identity relayed to the page contains only public info (userId, username) — never the JWT.
async function startup() {
  try {
    await chrome.runtime.sendMessage({ type: "PING" });
    console.log("[Viltrumera] content script connected to background worker");
    window.postMessage({ source: "viltrumera-ext", type: "READY", healthy: true }, "*");
  } catch (err) {
    console.warn("[Viltrumera] background worker not ready:", err.message);
    window.postMessage({ source: "viltrumera-ext", type: "READY", healthy: false }, "*");
    window.postMessage({ source: "viltrumera-ext", type: "IDENTIFIED", userId: null, personalized: false }, "*");
    return;
  }

  try {
    const identity = await chrome.runtime.sendMessage({ type: "IDENTIFY" });
    window.postMessage({ source: "viltrumera-ext", type: "IDENTIFIED", ...identity }, "*");
  } catch (err) {
    console.warn("[Viltrumera] identify failed:", err.message);
    window.postMessage({ source: "viltrumera-ext", type: "IDENTIFIED", userId: null, personalized: false }, "*");
  }
}

// Re-identify and notify the page when the background syncs (e.g. Sync Now button pressed).
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "EXTENSION_SYNCED") {
    window.postMessage({ source: "viltrumera-ext", type: "EXTENSION_READY" }, "*");
    // Re-fetch identity so the page gets updated user info after sync.
    chrome.runtime.sendMessage({ type: "IDENTIFY" })
      .then((identity) => {
        window.postMessage({ source: "viltrumera-ext", type: "IDENTIFIED", ...identity }, "*");
      })
      .catch((err) => {
        console.warn("[Viltrumera] re-identify after sync failed:", err.message);
      });
  }
});

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = { startup };
} else {
  startup();
}

// Bridge: page postMessage → chrome.runtime.sendMessage → page postMessage
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== "viltrumera") return;

  const { type, requestId } = event.data;
  if (!type || !requestId) return;

  if (!chrome.runtime?.id) {
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
    const response = await chrome.runtime.sendMessage(event.data);
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
