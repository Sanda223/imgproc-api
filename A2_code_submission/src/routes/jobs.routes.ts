// src/routes/jobs.routes.ts
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth";
import { runPipelineS3 } from "../services/process";
import { presignUpload, presignDownload } from "../services/s3.service";
import { initStore, addJob, updateJob, listJobs, getJobById, JobRecord } from "../data/jobs.ddb";

const r = Router();

// ---------------- In-memory cache (3 pts) ----------------
const LIST_CACHE = new Map(); // userId -> { data, expiresAt }
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
// ---------------------------------------------------------

// ensure the JSON store exists on first import
initStore().catch(() => {
  /* best-effort */
});

// ---- Create job ----
r.post("/", requireAuth, async (req, res, next) => {
  try {
    const { sourceId = "seed", ops } = req.body || {};
    if (!Array.isArray(ops) || ops.length === 0) {
      return res.status(400).json({ error: { code: "bad_request", message: "Provide ops array" } });
    }

    const id = randomUUID();
    const user = (req as any).user || {};
    const userId = user.sub ?? user.username ?? "unknown";

    // S3 keys
    const inputKey = sourceId === "seed" ? "seed/seed.png" : `users/${userId}/jobs/${id}/input`;
    const outputKey = `users/${userId}/jobs/${id}/output.png`;

    const job: JobRecord = {
      id,
      userId,
      sourceId,
      ops,
      status: sourceId === "seed" ? "processing" : "waiting_upload",
      createdAt: new Date().toISOString(),
      inputKey,
      outputKey,
    } as any;

    await addJob(job);
    invalidateUser(userId); // invalidate cache since new job added

    if (sourceId === "seed") {
      await runPipelineS3(inputKey, ops, outputKey);
      await updateJob(id, { status: "done", finishedAt: new Date().toISOString() });

      const downloadUrl = await presignDownload(outputKey);
      return res.status(201).json({ id, output: { imageId: id, url: downloadUrl } });
    }

    const uploadUrl = await presignUpload(inputKey, "image/png");
    return res.status(201).json({
      id,
      inputKey,
      outputKey,
      upload: { url: uploadUrl, key: inputKey },
      message: "Upload your image to the provided URL, then call the processing endpoint when ready.",
    });
  } catch (e) {
    next(e);
  }
});

// ---- Process job ----
r.post("/:id/process", requireAuth, async (req, res, next) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: { code: "not_found" } });

    const user = (req as any).user || {};
    const userId = user.sub ?? user.username ?? "unknown";
    if (job.userId !== userId) return res.status(403).json({ error: { code: "forbidden" } });

    if (job.status !== "waiting_upload" && job.status !== "failed") {
      return res.status(400).json({ error: { code: "bad_state", message: `Job is ${job.status}` } });
    }

    await updateJob(job.id, { status: "processing" });
    await runPipelineS3(job.inputKey!, job.ops, job.outputKey!);
    await updateJob(job.id, { status: "done", finishedAt: new Date().toISOString() });

    invalidateUser(userId); // clear cache since status changed

    const downloadUrl = await presignDownload(job.outputKey!);
    res.json({ id: job.id, output: { imageId: job.id, url: downloadUrl } });
  } catch (e) {
    next(e);
  }
});

// ---- Download output ----
r.get("/:id/download", requireAuth, async (req, res, next) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: { code: "not_found" } });

    const user = (req as any).user || {};
    const userId = user.sub ?? user.username ?? "unknown";
    if (job.userId !== userId) return res.status(403).json({ error: { code: "forbidden" } });

    if (job.status !== "done" || !job.outputKey) {
      return res.status(400).json({ error: { code: "bad_state", message: "Output not ready" } });
    }

    const url = await presignDownload(job.outputKey);
    res.json({ downloadUrl: url });
  } catch (e) {
    next(e);
  }
});

// ---- List jobs (with cache) ----
r.get("/", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user || {};
    const userId = user.sub ?? user.username ?? "unknown";

    // check cache first
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

// ---- Get single job ----
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