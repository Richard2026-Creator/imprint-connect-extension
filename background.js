// =====================================================================
// IMPRINT Connect — background service worker
// Opens the side panel when the toolbar icon is clicked.
// =====================================================================

function enableSidePanelOnClick() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(enableSidePanelOnClick);
chrome.runtime.onStartup.addListener(enableSidePanelOnClick);
enableSidePanelOnClick();
