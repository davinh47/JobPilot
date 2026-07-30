const pairing = document.querySelector("#pairing");
const ready = document.querySelector("#ready");
const tokenInput = document.querySelector("#token");
const baseUrlInput = document.querySelector("#baseUrl");
const pageUrl = document.querySelector("#pageUrl");
const status = document.querySelector("#status");
const openJob = document.querySelector("#openJob");

function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function jobPilotBaseUrl(value) {
  try {
    const url = new URL(value);
    const isLocal = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
    const isHosted = url.protocol === "https:" && url.hostname.includes(".");
    if (!isLocal && !isHosted) return null;
    if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function captureJobPage() {
  const compactText = (selector) => {
    const element = document.querySelector(selector);
    return element?.innerText?.replace(/\s+/g, " ").trim() || null;
  };
  const richText = (selector) => {
    const element = document.querySelector(selector);
    return element?.innerText
      ?.replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || null;
  };
  const firstCompact = (selectors) => selectors.map(compactText).find(Boolean) || null;
  const firstRich = (selectors) => selectors.map(richText).find(Boolean) || null;
  const canonical = document.querySelector("link[rel='canonical']")?.href || location.href;
  const description = firstRich(["[data-automation='jobAdDetails']", ".jobs-description__content", ".show-more-less-html__markup", "[data-testid='job-description']", "[class*='job-description']", "main", "article"]);
  return {
    url: canonical,
    capturedHtml: document.documentElement.outerHTML.slice(0, 1500000),
    capturedText: (richText("body") || description || "").slice(0, 120000),
    hints: {
      title: firstCompact(["[data-automation='job-detail-title']", "[data-testid='job-title']", "h1", ".top-card-layout__title"]),
      companyName: firstCompact(["[data-automation='advertiser-name']", ".job-details-jobs-unified-top-card__company-name", ".topcard__org-name-link", "[data-testid='company-name']", "[class*='company-name']"]),
      location: firstCompact(["[data-automation='job-detail-location']", ".job-details-jobs-unified-top-card__bullet", ".topcard__flavor--bullet", "[data-testid='job-location']", "[class*='location']"]),
      salaryText: firstCompact(["[data-automation*='salary']", "[data-testid*='salary']", "[class*='salary']", "[class*='compensation']"]),
      employmentType: firstCompact(["[data-automation*='work-type']", "[data-testid*='employment']", "[class*='employment-type']", "[class*='job-type']"]),
      descriptionText: description,
    },
  };
}

async function loadState() {
  const stored = await chrome.storage.local.get(["pairingToken", "baseUrl"]);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  pageUrl.textContent = tabs[0]?.url || "No active page";
  baseUrlInput.value = stored.baseUrl || "http://127.0.0.1:3000";
  pairing.hidden = Boolean(stored.pairingToken);
  ready.hidden = !stored.pairingToken;
}

document.querySelector("#pair").addEventListener("click", async () => {
  const pairingToken = tokenInput.value.trim();
  const baseUrl = jobPilotBaseUrl(baseUrlInput.value.trim());
  if (!pairingToken || !baseUrl) return showStatus("Enter a local HTTP or hosted HTTPS JobPilot URL and pairing token.", true);
  if (baseUrl.startsWith("https://")) {
    const granted = await chrome.permissions.request({ origins: [`${baseUrl}/*`] });
    if (!granted) return showStatus("Permission to connect to this JobPilot host was not granted.", true);
  }
  await chrome.storage.local.set({ pairingToken, baseUrl });
  tokenInput.value = "";
  showStatus("Paired. You can now save the current job page.");
  await loadState();
});

document.querySelector("#settings").addEventListener("click", async () => {
  await chrome.storage.local.remove("pairingToken");
  await loadState();
});

document.querySelector("#save").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  openJob.hidden = true;
  showStatus("Reading the current page…");
  try {
    const stored = await chrome.storage.local.get(["pairingToken", "baseUrl"]);
    const baseUrl = jobPilotBaseUrl(stored.baseUrl || "");
    if (!stored.pairingToken || !baseUrl) throw new Error("Pair the extension with JobPilot first.");
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (!activeTab?.id || !/^https?:/.test(activeTab.url || "")) throw new Error("Open a web job detail page first.");
    const execution = await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, func: captureJobPage });
    const captured = execution[0]?.result;
    if (!captured) throw new Error("The page could not be read.");
    showStatus("Saving and extracting the job…");
    const response = await fetch(`${baseUrl}/api/extension/jobs`, { method: "POST", headers: { Authorization: `Bearer ${stored.pairingToken}`, "Content-Type": "application/json" }, body: JSON.stringify(captured) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "JobPilot could not save this page.");
    showStatus(result.created ? "Saved to Job discovery." : "This job already exists. Its snapshot was refreshed.");
    openJob.href = result.jobUrl;
    openJob.hidden = false;
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Unable to save this page.", true);
  } finally {
    button.disabled = false;
  }
});

loadState();
