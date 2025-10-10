import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const REGION = process.env.AWS_REGION || "ap-southeast-2";
const client = new SSMClient({ region: REGION });

// Internal cache
let CACHE: { S3_BUCKET: string; JOBS_TABLE: string } | null = null;


async function getParam(name: string): Promise<string> {
  const res = await client.send(new GetParameterCommand({ Name: name }));
  if (!res.Parameter?.Value) throw new Error(`Missing param: ${name}`);
  return res.Parameter.Value;
}

// Load once at startup (server.ts calls this)
export async function loadConfig() {
  const s3Bucket = await getParam("/a2-n11594128/S3_BUCKET");
  const jobsTable = await getParam("/a2-n11594128/DDB_TABLE");

  CACHE = { S3_BUCKET: s3Bucket, JOBS_TABLE: jobsTable };
  console.log("Config loaded:", CACHE);
}

// Exported Config object
export const Config = {
  get S3_BUCKET() {
    if (!CACHE) throw new Error("Config not loaded yet. Call loadConfig() first.");
    return CACHE.S3_BUCKET;
  },
  get JOBS_TABLE() {
    if (!CACHE) throw new Error("Config not loaded yet. Call loadConfig() first.");
    return CACHE.JOBS_TABLE;
  },
};