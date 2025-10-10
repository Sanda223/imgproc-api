// public/main.js
const $ = (s) => document.querySelector(s);
const authStatus = $("#authStatus");
const jobResultEl = $("#jobResult");
const output = $("#output");

let lastJobId = null;

function clearJobUI() {
  if (jobResultEl) jobResultEl.textContent = "";
  if (output) output.innerHTML = "";
  const jf = document.getElementById("jobForm");
  if (jf && typeof jf.reset === "function") jf.reset();
  lastJobId = null;
}

let token = localStorage.getItem("jwt") || null;

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

function renderAuth() {
  const loggedIn = !!token && !isExpired(token);
  if (!loggedIn) {
    authStatus.textContent = "Not logged in";
    clearJobUI();
    return;
  }
  authStatus.innerHTML = 'Logged in ✅ &nbsp;<button id="logoutBtn">Logout</button>';
}

function toast(msg) {
  console.log(msg);
  alert(msg);
}

document.addEventListener("click", (e) => {
  const target = e.target;

  if (target && target.id === "logoutBtn") {
    localStorage.removeItem("jwt");
    token = null;
    clearJobUI();
    renderAuth();
    toast("Logged out");
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

async function safeJson(res) {
  return res
    .clone()
    .json()
    .catch(() => ({}));
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || "";
  }
}

// ---- SIGN UP ----
$("#signupForm").addEventListener("submit", async (e) => {
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
    $("#cUsername").value = body.username;
    $("#cCode").focus();
  } else {
    const err = await safeJson(res);
    toast("Signup failed: " + (err?.error?.message ?? res.statusText));
  }
});

// ---- CONFIRM (email code) ----
$("#confirmForm").addEventListener("submit", async (e) => {
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
    $("#username").value = body.username;
    $("#password").focus();
  } else {
    const err = await safeJson(res);
    toast("Confirm failed: " + (err?.error?.message ?? res.statusText));
  }
});

// ---- LOGIN ----
$("#loginForm").addEventListener("submit", async (e) => {
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

  // ⬇️ Automatically load recent jobs
  await showRecentJobs();
});

// ---- CREATE JOB ----
$("#jobForm").addEventListener("submit", async (e) => {
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
  }

  const data = await safeJson(res);

  if (res.ok) {
    lastJobId = data?.id || null;

    const url =
      data?.output?.url ??
      (data?.output?.imageId ? `/v1/images/${data.output.imageId}` : null);

    output.innerHTML = `
      ${url ? `<img src="${url}" alt="result" />` : "Job created, but no output URL yet."}
      <div style="margin-top:8px">
        <button id="downloadBtn" ${lastJobId ? "" : "disabled"}>Download Output</button>
        <button id="listJobsBtn" style="margin-left:8px">List My Jobs</button>
      </div>
      <div id="jobsList" style="margin-top:12px"></div>
    `;
  } else {
    output.textContent = "Job failed.";
  }
});

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

// ---- Show Jobs ----
async function onListJobsClicked() {
  await showRecentJobs();
}

// reusable function for both auto & manual load
async function showRecentJobs() {
  if (!token) return;
  const res = await fetch("/v1/jobs?limit=10&page=1", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await safeJson(res);
  const cacheHeader = res.headers.get("X-Cache") || "MISS";

  const container = document.getElementById("jobsList") || output;
  const items = Array.isArray(data.items) ? data.items : [];

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
          <td>${fmtDate(j.createdAt)}</td>
          <td>${canDownload ? `<button class="dlOneBtn" data-jobid="${j.id}">Download</button>` : "—"}</td>
        </tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="muted" style="margin-bottom:6px">Showing latest ${items.length} job(s) </div>
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;border-bottom:1px solid #e5e7eb;">Job ID</th>
          <th style="text-align:left;border-bottom:1px solid #e5e7eb;">Status</th>
          <th style="text-align:left;border-bottom:1px solid #e5e7eb;">Created</th>
          <th style="text-align:left;border-bottom:1px solid #e5e7eb;">Action</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

if (!token) {
  clearJobUI();
}