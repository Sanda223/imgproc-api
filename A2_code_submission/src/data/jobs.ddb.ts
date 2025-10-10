// src/data/jobs.ddb.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Config } from "../services/config"; // ✅ cached config

const REGION = process.env.AWS_REGION || "ap-southeast-2";
const QUT_USERNAME = process.env.QUT_USERNAME!;

export type JobStatus = "waiting_upload" | "processing" | "done" | "failed";

export interface JobRecord {
  id: string;
  userId: string;
  sourceId: string;
  ops: any[];
  status: JobStatus;
  createdAt: string;
  finishedAt?: string;
  inputKey?: string;
  outputKey?: string;
  outputPath?: string;
}

const client = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(client);

function skFor(userId: string, jobId: string) {
  return `user#${userId}#job#${jobId}`;
}

export async function initStore() {
  // no-op for Dynamo
}

export async function addJob(job: JobRecord) {
  await ddb.send(
    new PutCommand({
      TableName: Config.JOBS_TABLE, // ✅ cached
      Item: {
        "qut-username": QUT_USERNAME,
        sk: skFor(job.userId, job.id),
        ...job,
      },
    })
  );
}

export async function updateJob(id: string, patch: Partial<JobRecord>) {
  const current = await getJobById(id);
  if (!current) return;

  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) updates[k] = v;
  }

  const setExpr = Object.keys(updates)
    .map((k, i) => `#k${i} = :v${i}`)
    .join(", ");
  const exprAttrNames = Object.keys(updates).reduce(
    (acc, k, i) => ({ ...acc, [`#k${i}`]: k }),
    {} as any
  );
  const exprAttrValues = Object.values(updates).reduce(
    (acc, v, i) => ({ ...acc, [`:v${i}`]: v }),
    {} as any
  );

  await ddb.send(
    new UpdateCommand({
      TableName: Config.JOBS_TABLE, // ✅ cached
      Key: { "qut-username": QUT_USERNAME, sk: skFor(current.userId, id) },
      UpdateExpression: `SET ${setExpr}`,
      ExpressionAttributeNames: exprAttrNames,
      ExpressionAttributeValues: exprAttrValues,
    })
  );
}

export async function getJobById(id: string): Promise<JobRecord | undefined> {
  // brute force search by user prefix (simplest for assignment)
  const wide = await ddb.send(
    new QueryCommand({
      TableName: Config.JOBS_TABLE, // ✅ cached
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": "qut-username" },
      ExpressionAttributeValues: { ":pk": QUT_USERNAME },
    })
  );

  const item = (wide.Items || []).find((it: any) => it.id === id);
  return item as JobRecord | undefined;
}

export async function listJobs(userId: string, page = 1, limit = 20) {
  const prefix = `user#${userId}#job#`;

  const q = await ddb.send(
    new QueryCommand({
      TableName: Config.JOBS_TABLE, // ✅ cached
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "qut-username", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": QUT_USERNAME, ":prefix": prefix },
    })
  );

  const all = (q.Items || []) as JobRecord[];
  const total = all.length;
  const start = (page - 1) * limit;
  const items = all.slice(start, start + limit);
  return { items, total };
}