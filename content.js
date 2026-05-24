// Wake the background service worker, confirm readiness, then identify the user.
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
