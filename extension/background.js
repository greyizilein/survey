// Receives "open and fill" requests from the Surveyor web app (relayed by
// content.js's page bridge), opens the target survey in a new tab, and
// stashes the answers so content.js can auto-fill once that tab loads.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "SURVEYOR_OPEN_AND_FILL") return;
  const { url, answers } = message;
  chrome.storage.local.set(
    { surveyor_pending: { url, answers, createdAt: Date.now() } },
    () => {
      chrome.tabs.create({ url });
      sendResponse({ ok: true });
    },
  );
  return true;
});
