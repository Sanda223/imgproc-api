// public/main.js
const $ = (s) => document.querySelector(s);
const authStatus = $("#authStatus");
const jobResultEl = $("#jobResult");
const output = $("#output");
const outputArea = document.getElementById("outputArea"); // dashboard variant
const jobsListEl = document.getElementById("jobsList");

let lastJobId = null;
let token = localStorage.getItem("jwt") || null;

// ----------------- Utility -----------------
function toast(msg) {
  console.log(msg);
  alert(msg);
}

async function safeJson(res) {
  return res.clone().json().catch(() => ({}));
}

function parseJwt(t) {
  try {
    const base64Url = t.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return {};
  }
}

function isExpired(tok) {
  if (!tok) return true;
  const payload = parseJwt(tok);
  const exp = payload.exp;
  if (!exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return now >= exp;
}

function ensureTokenFresh() {
  if (token && isExpired(token)) {
    localStorage.removeItem("jwt");
    token = null;
    clearJobUI();
    renderAuth();
  }
}

function clearJobUI() {
  if (jobResultEl) jobResultEl.textContent = "";
  const outEl = outputArea || output;
  if (outEl) outEl.innerHTML = "";
  renderOutputActions(false);
  const jf = document.getElementById("jobForm");
  if (jf && typeof jf.reset === "function") jf.reset();
  lastJobId = null;
}

function renderAuth() {
  const loggedIn = !!token && !isExpired(token);
  if (!authStatus) return;
  if (!loggedIn) {
    authStatus.textContent = "Not logged in";
    clearJobUI();
    return;
  }
  authStatus.innerHTML = 'Logged in ✅ &nbsp;<button id="logoutBtn">Logout</button>';
}

// Page-level helpers
const path = window.location.pathname;
const isDashboard =
  path === "/" || path.startsWith("/dashboard");

// If on dashboard without a valid token, bounce to login
if (isDashboard && (!token || isExpired(token))) {
  window.location.replace("/login");
}

// ----------------- Global handlers -----------------
document.addEventListener("click", (e) => {
  const target = e.target;

  if (target && target.id === "logoutBtn") {
    localStorage.removeItem("jwt");
    token = null;
    clearJobUI();
    renderAuth();
    toast("Logged out");
    window.location.href = "/login";
  }

  if (target && target.id === "downloadBtn") {
    onDownloadClicked().catch(() => toast("Failed to get download link."));
  }

  if (target && target.id === "listJobsBtn") {
    onListJobsClicked().catch(() => toast("Failed to list jobs."));
  }

  if (target && target.classList.contains("dlOneBtn")) {
    const jobId = target.getAttribute("data-jobid");
    downloadById(jobId).catch(() => toast("Failed to get download link."));
  }
});

ensureTokenFresh();
renderAuth();

// Auto-load jobs when landing on dashboard with a valid token
if (isDashboard && token && !isExpired(token)) {
  renderOutputActions(!!lastJobId); // show button (disabled if none yet)
  showRecentJobs().catch(() => {});
}

// ----------------- AUTH -----------------
const signupForm = document.getElementById("signupForm");
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      username: $("#suUsername").value.trim(),
      password: $("#suPassword").value,
      email: $("#suEmail").value.trim(),
    };
    const res = await fetch("/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      toast("Signup successful! Check email for the confirmation code.");
      localStorage.setItem("pendingUser", body.username);
      window.location.href = "/confirm";
    } else {
      const err = await safeJson(res);
      toast("Signup failed: " + (err?.error?.message ?? res.statusText));
    }
  });
}

const confirmForm = document.getElementById("confirmForm");
if (confirmForm) {
  const pendingUser = localStorage.getItem("pendingUser");
  if (pendingUser && $("#cUsername")) $("#cUsername").value = pendingUser;

  confirmForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      username: $("#cUsername").value.trim(),
      code: $("#cCode").value.trim(),
    };
    const res = await fetch("/v1/auth/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      toast("Email confirmed! You can now log in.");
      localStorage.removeItem("pendingUser");
      window.location.href = "/login";
    } else {
      const err = await safeJson(res);
      toast("Confirm failed: " + (err?.error?.message ?? res.statusText));
    }
  });
}

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      username: $("#username").value.trim(),
      password: $("#password").value,
    };
    const res = await fetch("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await safeJson(res);
      toast("Login failed: " + (err?.error?.message ?? res.statusText));
      return;
    }
    const data = await res.json();
    token = data.token;
    localStorage.setItem("jwt", token);
    clearJobUI();
    renderAuth();
    toast("Logged in");
    window.location.href = "/dashboard";
  });
}

// ----------------- JOBS -----------------
const jobForm = document.getElementById("jobForm");
if (jobForm) {
  jobForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!token) {
      toast("Login first");
      return;
    }

    const ops = [
      { op: "resize", width: parseInt($("#w").value, 10), height: parseInt($("#h").value, 10) },
      { op: "blur", sigma: parseInt($("#blur").value, 10) },
      { op: "sharpen", sigma: parseInt($("#sharpen").value, 10) },
    ];

    const body = { sourceId: $("#sourceId").value, ops };
    const res = await fetch("/v1/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      localStorage.removeItem("jwt");
      token = null;
      clearJobUI();
      renderAuth();
      toast("Session expired. Please log in again.");
      return;
    }

    const data = await safeJson(res);

    if (res.ok) {
      lastJobId = data?.id || null;
      const url =
        data?.output?.url ??
        (data?.output?.imageId ? `/v1/images/${data.output.imageId}` : null);

      const outEl = outputArea || output;
      if (outEl) {
        const hasOutput = !!url;
        // Put image (or message) into the preview box only
        outEl.innerHTML = hasOutput
          ? `<img src="${url}" alt="result" style="max-width:100%;max-height:100%;height:auto;display:block;object-fit:contain;" />`
          : "Job created, but no output URL yet.";

        // Render/refresh the download button in the header actions area
        renderOutputActions(hasOutput);
      }

      // 🔄 refresh the Job History after creating a job
      await showRecentJobs();
    } else {
      const outEl = outputArea || output;
      if (outEl) outEl.textContent = "Job failed.";
    }
  });
}

function renderOutputActions(enabled) {
  const actions = document.getElementById("outputActions");
  if (!actions) return;
  const disabled = !(enabled && lastJobId);
  actions.innerHTML = `<button id="downloadBtn" ${disabled ? "disabled" : ""}>Download Output</button>`;
}

async function onDownloadClicked() {
  if (!token) {
    toast("Login first");
    return;
  }
  if (!lastJobId) {
    toast("No job to download yet.");
    return;
  }
  await downloadById(lastJobId);
}

async function downloadById(jobId) {
  const res = await fetch(`/v1/jobs/${jobId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await safeJson(res);
    toast("Failed to get download link: " + (err?.error?.message ?? res.statusText));
    return;
  }
  const data = await res.json();
  window.open(data.downloadUrl, "_blank");
}

async function onListJobsClicked() {
  await showRecentJobs();
}

async function showRecentJobs() {
  if (!token) return;
  const res = await fetch("/v1/jobs?limit=10&page=1", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await safeJson(res);

  const container = document.getElementById("jobsList") || (outputArea || output);
  const items = Array.isArray(data.items) ? data.items : [];

  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `<div class="muted">No jobs yet.</div>`;
    return;
  }

  const rows = items
    .map((j) => {
      const canDownload = j.status === "done" && j.outputKey;
      return `
        <tr>
          <td title="${j.id}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;">${j.id}</td>
          <td>${j.status}</td>
          <td>${new Date(j.createdAt).toLocaleString()}</td>
          <td>${canDownload ? `<button class="dlOneBtn" data-jobid="${j.id}">Download</button>` : "—"}</td>
        </tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="muted" style="margin-bottom:6px">Showing latest ${items.length} job(s)</div>
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;border-bottom:1px solid #5c58a3;">Job ID</th>
          <th style="text-align:left;border-bottom:1px solid #5c58a3;">Status</th>
          <th style="text-align:left;border-bottom:1px solid #5c58a3;">Created</th>
          <th style="text-align:left;border-bottom:1px solid #5c58a3;">Action</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}