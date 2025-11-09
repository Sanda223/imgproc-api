// public/main.js
const $ = (s) => document.querySelector(s);
const authStatus = $("#authStatus");
const jobResultEl = $("#jobResult");
const output = $("#output");
const outputArea = document.getElementById("outputArea");
const jobsListEl = document.getElementById("jobsList");
const imageInput = document.getElementById("imageFile");

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
  if (imageInput) imageInput.value = "";
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

// ----------------- Page helpers -----------------
const path = window.location.pathname;
const isDashboard = path === "/" || path.startsWith("/dashboard");

if (isDashboard && (!token || isExpired(token))) {
  window.location.replace("/login");
}

// ----------------- Global handlers -----------------
document.addEventListener("click", (e) => {
  const target = e.target;
  if (!target) return;

  if (target.id === "logoutBtn") {
    localStorage.removeItem("jwt");
    token = null;
    clearJobUI();
    renderAuth();
    toast("Logged out");
    window.location.href = "/login";
  }

  if (target.id === "downloadBtn") {
    onDownloadClicked().catch(() => toast("Failed to get download link."));
  }

  if (target.id === "listJobsBtn") {
    onListJobsClicked().catch(() => toast("Failed to list jobs."));
  }

  if (target.classList.contains("dlOneBtn")) {
    const jobId = target.getAttribute("data-jobid");
    downloadById(jobId).catch(() => toast("Failed to get download link."));
  }
});

ensureTokenFresh();
renderAuth();

if (isDashboard && token && !isExpired(token)) {
  renderOutputActions(!!lastJobId);
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
      toast("Signup successful! Check email for confirmation.");
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

// ----------------- JOB FLOW -----------------
const jobForm = document.getElementById("jobForm");
if (jobForm) {
  jobForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!token) {
      toast("Login first");
      return;
    }

    const width = parseInt($("#w").value, 10);
    const height = parseInt($("#h").value, 10);
    const blur = parseInt($("#blur").value, 10);
    const sharpen = parseInt($("#sharpen").value, 10);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      toast("Width and height must be positive numbers.");
      return;
    }

    const ops = [
      { op: "resize", width, height },
      { op: "blur", sigma: Number.isFinite(blur) ? blur : 0 },
      { op: "sharpen", sigma: Number.isFinite(sharpen) ? sharpen : undefined },
    ];

    const file = imageInput?.files?.[0];
    if (!file) {
      toast("Choose an image to upload.");
      return;
    }

    try {
      // 1️⃣ Create job and get presigned upload URL
      const createRes = await fetch("/v1/jobs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ops,
          contentType: file.type,
        }),
      });

      if (!createRes.ok) throw new Error("Failed to create job.");
      const jobData = await createRes.json();
      lastJobId = jobData.id;
      toast("Job created, uploading image...");

      // 2️⃣ Upload image directly to S3
      const uploadUrl = jobData?.upload?.url;
      if (!uploadUrl) throw new Error("Missing upload URL.");

      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      toast("Image uploaded. Processing...");

      // 3️⃣ Trigger processing (enqueue job)
      const procRes = await fetch(`/v1/jobs/${lastJobId}/process`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!procRes.ok) throw new Error("Failed to start processing.");
      toast("Job queued for processing.");

      // 🔄 Start polling for completion and preview when done
      waitForJobDone(lastJobId).catch(console.error);

      await showRecentJobs();
    } catch (err) {
      console.error(err);
      toast("Job failed: " + err.message);
      const outEl = outputArea || output;
      if (outEl) outEl.textContent = "Job failed.";
    }
  });
}

// 🔄 Poll until job is done and show image preview
async function waitForJobDone(jobId) {
  for (let i = 0; i < 15; i++) { // ~30s total
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`/v1/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) continue;
    const job = await res.json();
    if (job.status === "done") {
      const dlRes = await fetch(`/v1/jobs/${jobId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!dlRes.ok) break;
      const data = await dlRes.json();
      const outEl = outputArea || output;
      outEl.innerHTML = `<img src="${data.downloadUrl}" alt="Processed image" style="max-width:100%;max-height:100%;height:auto;display:block;object-fit:contain;" />`;
      toast("✅ Job complete!");
      await showRecentJobs();
      return;
    }
  }
  toast("Job still processing or failed to complete.");
}

// ----------------- Download & Listing -----------------
function renderOutputActions(enabled) {
  const actions = document.getElementById("outputActions");
  if (!actions) return;
  const disabled = !(enabled && lastJobId);
  actions.innerHTML = `<button id="downloadBtn" ${disabled ? "disabled" : ""}>Download Output</button>`;
}

async function onDownloadClicked() {
  if (!token) return toast("Login first");
  if (!lastJobId) return toast("No job to download yet.");
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
  const outEl = outputArea || output;
  outEl.innerHTML = `<img src="${data.downloadUrl}" alt="Processed image" style="max-width:100%;max-height:100%;height:auto;display:block;object-fit:contain;" />`;
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
          <th>Job ID</th><th>Status</th><th>Created</th><th>Action</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}