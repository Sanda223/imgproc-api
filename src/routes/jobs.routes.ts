// src/routes/jobs.routes.ts
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth";
import { presignUpload, presignDownload } from "../services/s3.service";
import {
  initStore,
  addJob,
  updateJob,
  listJobs,
  getJobById,
  JobRecord,
  listAllJobs,
} from "../data/jobs.ddb";
import { requireGroup } from "../middleware/requireGroup";
import { enqueueJob } from "../services/sqs.service"; // ✅ NEW

const r = Router();

// ---------------- In-memory cache for list ---------------------------------
const LIST_CACHE = new Map<string, { data: any; expiresAt: number }>(); // userId -> { data, expiresAt }
const TTL_MS = 30 * 1000; // 30 seconds cache

function getFromCache(userId: string) {
  const entry = LIST_CACHE.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    LIST_CACHE.delete(userId);
    return null;
  }
  return entry.data;
}

function setCache(userId: string, data: any) {
  LIST_CACHE.set(userId, { data, expiresAt: Date.now() + TTL_MS });
}

function invalidateUser(userId: string) {
  LIST_CACHE.delete(userId);
}

// ensure the data store exists
initStore().catch(() => {
  /* best-effort */
});

// ---------------- Admin-only: list all jobs (cap at 50) --------------------
r.get(
  "/admin/all",
  requireAuth,
  requireGroup("imgproc-admins"),
  async (_req, res, next) => {
    try {
      const { items, total } = await listAllJobs(50);
      res.json({ items, total });
    } catch (e) {
      next(e);
    }
  }
);

// ---- Create job (ALWAYS presign for upload) -------------------------------
// Client sends JSON: { ops: [...], contentType?: "image/png"|"image/jpeg" }
r.post("/", requireAuth, async (req, res, next) => {
  try {
    const rawOps = (req.body?.ops ?? req.body?.operations) as any;
    let opsCandidate = rawOps;
    if (typeof rawOps === "string") {
      try {
        opsCandidate = JSON.parse(rawOps);
      } catch {
        return res
          .status(400)
          .json({ error: { code: "bad_request", message: "Invalid ops JSON payload" } });
      }
    }
    const ops = Array.isArray(opsCandidate) ? opsCandidate : [];
    if (!Array.isArray(ops) || ops.length === 0) {
      return res
        .status(400)
        .json({ error: { code: "bad_request", message: "Provide ops array" } });
    }

    const id = randomUUID();
    const user = (req as any).user || {};
    const userId = user.sub ?? user.username ?? "unknown";

    const inputKey = `users/${userId}/jobs/${id}/input`;
    const outputKey = `users/${userId}/jobs/${id}/output.png`;

    const job: JobRecord = {
      id,
      userId,
      sourceId: "upload",
      ops,
      status: "waiting_upload",
      createdAt: new Date().toISOString(),
      inputKey,
      outputKey,
    } as any;

    await addJob(job);
    invalidateUser(userId);

    const contentType = (() => {
      const candidate =
        typeof req.body?.contentType === "string" ? req.body.contentType : "image/png";
      const allowed = ["image/png", "image/jpeg"];
      return allowed.includes(candidate) ? candidate : "image/png";
    })();

    const uploadUrl = await presignUpload(inputKey, contentType);
    return res.status(201).json({
      id,
      inputKey,
      outputKey,
      upload: { url: uploadUrl, key: inputKey, contentType },
      message: "Upload your image to the provided URL, then call /v1/jobs/:id/process.",
    });
  } catch (e) {
    next(e);
  }
});

// ---- Process job (enqueue to SQS for worker) ------------------------------
r.post("/:id/process", requireAuth, async (req, res, next) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: { code: "not_found" } });

    const user = (req as any).user || {};
    const userId = user.sub ?? user.username ?? "unknown";
    if (job.userId !== userId) {
      return res.status(403).json({ error: { code: "forbidden" } });
    }

    if (job.status !== "waiting_upload" && job.status !== "failed") {
      return res
        .status(400)
        .json({ error: { code: "bad_state", message: `Job is ${job.status}` } });
    }

    // Make sure we actually have S3 keys before enqueuing
    if (!job.inputKey || !job.outputKey) {
      return res.status(400).json({
        error: {
          code: "bad_state",
          message: "Job is missing S3 keys; recreate the job.",
        },
      });
    }

    // Move job into processing state before enqueue
    await updateJob(job.id, { status: "processing" });
    invalidateUser(userId);

    // Enqueue work for the worker service via SQS
    await enqueueJob({
      jobId: job.id,
      userId,
      inputKey: job.inputKey,
      outputKey: job.outputKey,
      ops: job.ops,
    });

    // Respond to client – processing happens asynchronously now
    return res.status(202).json({
      id: job.id,
      status: "processing",
      message: "Job has been queued for processing.",
    });
  } catch (e) {
    next(e);
  }
});

// ---- Download output -------------------------------------------------------
r.get("/:id/download", requireAuth, async (req, res, next) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: { code: "not_found" } });

    const user = (req as any).user || {};
    const userId = user.sub ?? user.username ?? "unknown";
    if (job.userId !== userId)
      return res.status(403).json({ error: { code: "forbidden" } });

    if (job.status !== "done" || !job.outputKey) {
      return res
        .status(400)
        .json({ error: { code: "bad_state", message: "Output not ready" } });
    }

    const url = await presignDownload(job.outputKey);
    res.json({ downloadUrl: url });
  } catch (e) {
    next(e);
  }
});

// ---- List jobs (with cache) ------------------------------------------------
r.get("/", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user || {};
    const userId = user.sub ?? user.username ?? "unknown";

    const cached = getFromCache(userId);
    if (cached) {
      res.set("X-Cache", "HIT");
      return res.json(cached);
    }

    const page = Math.max(parseInt(String(req.query.page ?? "1"), 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
      100
    );

    const { items, total } = await listJobs(userId, page, limit);
    const data = { items, page, limit, total };

    setCache(userId, data);
    res.set("X-Cache", "MISS");
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// ---- Get single job --------------------------------------------------------
r.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: { code: "not_found" } });
    res.json(job);
  } catch (e) {
    next(e);
  }
});

export default r;
