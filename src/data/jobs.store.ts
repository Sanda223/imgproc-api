// src/data/jobs.store.ts
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

const STORE_DIR = join(process.cwd(), 'storage', 'data');
const STORE_PATH = join(STORE_DIR, 'jobs.json');

export type JobStatus = 'waiting_upload' | 'processing' | 'done' | 'failed';

export interface JobRecord {
  id: string;
  userId: string;
  sourceId: string;
  ops: any[];
  status: JobStatus;
  createdAt: string;
  finishedAt?: string;

  // NEW for S3-based processing
  inputKey?: string;   // e.g. "seed/seed.png" or "users/<uid>/jobs/<id>/input"
  outputKey?: string;  // e.g. "users/<uid>/jobs/<id>/output.png"

  // Legacy (from A1 local file flow) — kept for back-compat
  outputPath?: string; // e.g. storage/outputs/<id>.png
}

interface JobsFile {
  jobs: JobRecord[];
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

export async function initStore() {
  await ensureDir(STORE_DIR);
  try {
    await fs.access(STORE_PATH);
  } catch {
    const initial: JobsFile = { jobs: [] };
    await fs.writeFile(STORE_PATH, JSON.stringify(initial, null, 2));
  }
}

async function readAll(): Promise<JobsFile> {
  await initStore();
  const buf = await fs.readFile(STORE_PATH, 'utf8');
  return JSON.parse(buf) as JobsFile;
}

async function writeAll(data: JobsFile) {
  await ensureDir(dirname(STORE_PATH));
  await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));
}

export async function addJob(job: JobRecord) {
  const data = await readAll();
  data.jobs.unshift(job); // newest first
  await writeAll(data);
}

export async function updateJob(id: string, patch: Partial<JobRecord>) {
  const data = await readAll();
  const idx = data.jobs.findIndex(j => j.id === id);
  if (idx === -1) return;
  data.jobs[idx] = { ...data.jobs[idx], ...patch };
  await writeAll(data);
}

export async function getJobById(id: string): Promise<JobRecord | undefined> {
  const data = await readAll();
  return data.jobs.find(j => j.id === id);
}

export async function listJobs(userId: string, page = 1, limit = 20) {
  const data = await readAll();
  const all = data.jobs.filter(j => j.userId === userId);
  const total = all.length;
  const start = (page - 1) * limit;
  const items = all.slice(start, start + limit);
  return { items, total };
}