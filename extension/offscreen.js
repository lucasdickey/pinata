// The offscreen document's one job: turn a capture file's text into a blob
// URL the service worker can download, and release it afterwards. A service
// worker cannot make blob URLs itself.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return false;
  if (message.type === "offscreen-blob") {
    const blob = new Blob([message.json], { type: "application/json" });
    sendResponse({ url: URL.createObjectURL(blob) });
    return false;
  }
  if (message.type === "offscreen-revoke") {
    URL.revokeObjectURL(message.url);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
