
const BASE = process.env.WORKER_BASE_URL!;
const SECRET = process.env.WORKER_SHARED_SECRET!;

export async function workerProcess(inputKey: string, outputKey: string, ops: any[]) {
  if (!BASE || !SECRET) throw new Error("Worker config missing");
  const res = await fetch(`${BASE}/v1/worker/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": SECRET,
    },
    body: JSON.stringify({ inputKey, outputKey, ops }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Worker failed: ${res.status} ${txt}`);
  }
  return res.json();
}