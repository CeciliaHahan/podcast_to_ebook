const button = document.getElementById("open-sidepanel");

button?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) {
    window.close();
    return;
  }
  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});
