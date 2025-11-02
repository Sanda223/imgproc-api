// src/min-server.ts
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { runPipelineS3 } from "./services/process";

// ---- config (env) ----------------------------------------------------------
const PORT = parseInt(process.env.WORKER_PORT || "3001", 10);
const SHARED_TOKEN = process.env.WORKER_TOKEN || ""; // optional simple auth

// ---- app -------------------------------------------------------------------
const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

// Health
app.get("/", (_req, res) => res.send("worker-ok"));

// Simple shared-secret check (optional but useful when exposed via ALB/VPC)
function verifyToken(req: express.Request): boolean {
  const hdr = req.header("X-Worker-Token") || "";
  return !SHARED_TOKEN || hdr === SHARED_TOKEN;
}

/**
 * POST /v1/worker/process
 * Body: { inputKey: string, outputKey: string, ops: Array<any> }
 * Does the CPU-intensive sharp pipeline and returns 200 when done.
 */
app.post("/v1/worker/process", async (req, res) => {
  if (!verifyToken(req)) return res.status(401).json({ error: "unauthorised" });

  const { inputKey, outputKey, ops } = req.body || {};
  if (!inputKey || !outputKey || !Array.isArray(ops) || ops.length === 0) {
    return res.status(400).json({ error: "bad_request" });
  }

  try {
    await runPipelineS3(String(inputKey), ops, String(outputKey));
    return res.status(200).json({ ok: true, outputKey });
  } catch (err: any) {
    console.error("worker-process-error:", err?.message || err);
    return res.status(500).json({ error: "processing_failed" });
  }
});

app.listen(PORT, () => {
  console.log(`🛠️  Worker service listening on :${PORT}`);
});