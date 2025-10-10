import { Router } from "express";
import { presignUpload, presignDownload } from "../services/s3.service";
// keep using your current auth for now; later we’ll swap to Cognito
import { requireAuth } from "../middleware/auth";

const router = Router();

/**
 * Ask server for a pre-signed PUT URL to upload an image to S3.
 * body: { jobId: string, contentType?: string }
 */
router.post("/v1/files/presign-upload", requireAuth, async (req, res, next) => {
  try {
    const { jobId, contentType = "image/png" } = req.body;
    const userId = (req as any).user?.sub || (req as any).user?.id || "user"; // temp; Cognito later
    const key = `users/${userId}/jobs/${jobId}/input`;
    const url = await presignUpload(key, contentType);
    res.json({ url, key });
  } catch (e) { next(e); }
});

/**
 * Ask server for a pre-signed GET URL to download an object from S3.
 * query: ?key=...
 */
router.get("/v1/files/presign-download", requireAuth, async (req, res, next) => {
  try {
    const key = String(req.query.key);
    const url = await presignDownload(key);
    res.json({ url });
  } catch (e) { next(e); }
});

export default router;