const pairing = document.querySelector("#pairing");
const ready = document.querySelector("#ready");
const tokenInput = document.querySelector("#token");
const baseUrlInput = document.querySelector("#baseUrl");
const baseUrlField = document.querySelector("#baseUrlField");
const pageUrl = document.querySelector("#pageUrl");
const status = document.querySelector("#status");
const openJob = document.querySelector("#openJob");
const DEFAULT_BASE_URL = "__JOBPILOT_DEFAULT_URL__";
const configuredDefaultBaseUrl = DEFAULT_BASE_URL.startsWith("__") ? "" : DEFAULT_BASE_URL;

function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function jobPilotBaseUrl(value) {
  try {
    const normalized = value.trim().replace(/^[('"“‘<\[]+|[)"'”’>\]]+$/g, "");
    const url = new URL(normalized);
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
  const noiseSelectors = "script,style,noscript,template,svg,canvas,iframe,nav,header,footer,aside,form,button,input,select,textarea,[role='button'],[role='navigation'],[role='menu'],[role='menuitem'],[role='dialog'],[role='alert'],[aria-hidden='true'],[class*='cookie'],[class*='modal'],[class*='breadcrumb'],[class*='share'],[class*='social'],[class*='save-job'],[class*='favorite'],[class*='recommend'],[class*='similar-job'],[data-testid*='apply'],[data-automation*='apply'],a[class*='button'],a[class*='btn'],a[href*='apply']";
  const normalize = (value) => value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const readable = (element) => {
    if (!element) return null;
    const clone = element.cloneNode(true);
    clone.querySelectorAll(noiseSelectors).forEach((node) => node.remove());
    return normalize(clone.innerText || clone.textContent || "") || null;
  };
  const text = (selector) => {
    const element = document.querySelector(selector);
    const attribute = element?.getAttribute("content") || element?.getAttribute("aria-label") || element?.getAttribute("title");
    const value = attribute?.replace(/\s+/g, " ").trim() || readable(element)?.replace(/\s+/g, " ").trim() || null;
    return value ? value.slice(0, 300) : null;
  };
  const firstElement = (selectors) => selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;
  const first = (selectors) => selectors.map(text).find(Boolean) || null;
  const canonical = document.querySelector("link[rel='canonical']")?.href || location.href;
  const descriptionElement = firstElement(["[data-automation='jobAdDetails']", ".jobs-description__content", ".show-more-less-html__markup", "[data-testid='job-description']", "[data-testid='jobDescriptionText']", "[class*='job-description']", "[class*='jobDescription']", "[itemprop='description']", "article", "main"]);
  const targetedText = readable(descriptionElement);
  const cleanedBodyText = readable(document.body);
  const jobSignals = /responsibilities|requirements|qualifications|job description|about the role|工作职责|岗位职责|任职要求|职位描述|岗位描述/i;
  const targetedIsUseful = targetedText && targetedText.length >= 120 && jobSignals.test(targetedText);
  const description = targetedIsUseful ? targetedText : cleanedBodyText || targetedText || "";
  return {
    url: canonical,
    capturedText: description?.slice(0, 120000) || "",
    hints: {
      title: first(["[data-automation='job-detail-title']", "[data-testid='job-title']", "[data-qa*='job-title']", "h1", ".top-card-layout__title", "[class*='job-title']", "[class*='position-title']", "meta[property='og:title']", "meta[name='twitter:title']"]) || document.title || null,
      companyName: first(["[data-automation='advertiser-name']", ".job-details-jobs-unified-top-card__company-name", ".topcard__org-name-link", "[data-testid='company-name']", "[data-qa*='company']", "[itemprop='hiringOrganization'] [itemprop='name']", "[itemprop='hiringOrganization']", "[class*='company-name']", "[class*='employer']", "[class*='organization']", "a[href*='/company/']", "meta[property='og:site_name']"]),
      location: first(["[data-automation='job-detail-location']", ".job-details-jobs-unified-top-card__bullet", ".topcard__flavor--bullet", "[data-testid='job-location']", "[data-qa*='location']", "[itemprop='jobLocation']", "[class*='location']"]),
      salaryText: first(["[data-automation*='salary']", "[data-testid*='salary']", "[class*='salary']", "[class*='compensation']"]),
      employmentType: first(["[data-automation*='employment']", "[data-testid*='employment']", "[class*='employment']", "[class*='job-type']"]),
      descriptionText: description,
    },
  };
}

async function loadState() {
  const stored = await chrome.storage.local.get(["pairingToken", "baseUrl"]);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  pageUrl.textContent = tabs[0]?.url || "No active page";
  baseUrlInput.value = configuredDefaultBaseUrl || stored.baseUrl || "http://127.0.0.1:3000";
  if (baseUrlField) baseUrlField.hidden = Boolean(configuredDefaultBaseUrl);
  pairing.hidden = Boolean(stored.pairingToken);
  ready.hidden = !stored.pairingToken;
}

document.querySelector("#pair").addEventListener("click", async () => {
  const pairingToken = tokenInput.value.trim();
  const baseUrl = jobPilotBaseUrl(configuredDefaultBaseUrl || baseUrlInput.value.trim());
  if (!pairingToken) return showStatus("Paste the pairing token from JobPilot first.", true);
  if (!baseUrl) return showStatus("Enter the JobPilot root URL, such as https://try-jobpilot.vercel.app.", true);
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
    const baseUrl = jobPilotBaseUrl(configuredDefaultBaseUrl || stored.baseUrl || "");
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
    showStatus(result.aiQueued
      ? "Saved to Job discovery. AI cleanup is running in the background."
      : result.created
        ? "Saved to Job discovery."
        : "This job already exists. Its snapshot was refreshed.");
    openJob.href = result.jobUrl;
    openJob.hidden = false;
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Unable to save this page.", true);
  } finally {
    button.disabled = false;
  }
});

loadState();
