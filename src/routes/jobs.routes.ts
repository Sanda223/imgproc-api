// src/routes/jobs.routes.ts
import { Router } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { requireAuth } from "../middleware/auth";
import { runPipelineBuffer, runPipelineS3 } from "../services/process";
import { presignUpload, presignDownload } from "../services/s3.service";
import { initStore, addJob, updateJob, listJobs, getJobById, JobRecord } from "../data/jobs.ddb";
import { requireGroup } from "../middleware/requireGroup";
import { listAllJobs } from "../data/jobs.ddb";

const r = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB cap for uploads
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only PNG and JPEG images are allowed."));
    }
    cb(null, true);
  },
});

// ---------------- In-memory cache ----------------
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

// Admin-only: list all jobs (cap at 50 for demo)
r.get("/admin/all", requireAuth, requireGroup("imgproc-admins"), async (req, res, next) => {
  try {
    const { items, total } = await listAllJobs(50);
    res.json({ items, total });
  } catch (e) {
    next(e);
  }
});

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
r.post("/", requireAuth, upload.single("image"), async (req, res, next) => {
  try {
    const file = req.file;
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
      return res.status(400).json({ error: { code: "bad_request", message: "Provide ops array" } });
    }

    const id = randomUUID();
    const user = (req as any).user || {};
    const userId = user.sub ?? user.username ?? "unknown";

    const sourceId = "upload";

    // S3 keys
    const inputKey = `users/${userId}/jobs/${id}/input`;
    const outputKey = `users/${userId}/jobs/${id}/output.png`;

    const job: JobRecord = {
      id,
      userId,
      sourceId,
      ops,
      status: file ? "processing" : "waiting_upload",
      createdAt: new Date().toISOString(),
      inputKey: file ? undefined : inputKey,
      outputKey,
    } as any;

    await addJob(job);
    invalidateUser(userId); // invalidate cache since new job added

    if (file) {
      try {
        await runPipelineBuffer(file.buffer, ops, outputKey);
        await updateJob(id, { status: "done", finishedAt: new Date().toISOString() });
      } catch (err) {
        await updateJob(id, { status: "failed", finishedAt: new Date().toISOString() });
        throw err;
      }

      const downloadUrl = await presignDownload(outputKey);
      return res.status(201).json({ id, output: { imageId: id, url: downloadUrl } });
    }

    if (!file) {
      const contentType = (() => {
        const candidate = typeof req.body?.contentType === "string" ? req.body.contentType : "image/png";
        const allowed = ["image/png", "image/jpeg"];
        return allowed.includes(candidate) ? candidate : "image/png";
      })();
      const uploadUrl = await presignUpload(inputKey, contentType);
      return res.status(201).json({
        id,
        inputKey,
        outputKey,
        upload: { url: uploadUrl, key: inputKey, contentType },
        message: "Upload your image to the provided URL, then call the processing endpoint when ready.",
      });
    }

    return res.status(201).json({
      id,
      output: { imageId: id, url: await presignDownload(outputKey) },
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
