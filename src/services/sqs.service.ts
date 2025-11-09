// src/services/sqs.service.ts
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { runPipelineS3 } from "./process";
import { getJobById, updateJob } from "../data/jobs.ddb";

const REGION = process.env.AWS_REGION || "ap-southeast-2";
const QUEUE_URL = process.env.SQS_QUEUE_URL || "";

const sqs = new SQSClient({ region: REGION });

export type JobMessagePayload = {
  jobId: string;
  userId: string;
  inputKey: string;
  outputKey: string;
  ops: any[];
};

// ---------------------------------------------------------------------------
// API side: enqueue a job into SQS
// ---------------------------------------------------------------------------
export async function enqueueJob(payload: JobMessagePayload): Promise<void> {
  if (!QUEUE_URL) {
    throw new Error("SQS_QUEUE_URL is not set; cannot enqueue job.");
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify(payload),
    })
  );
}

// ---------------------------------------------------------------------------
// Worker side: long-poll SQS and process jobs
// ---------------------------------------------------------------------------
export async function startSqsWorkerLoop(): Promise<void> {
  if (!QUEUE_URL) {
    console.warn(
      "[SQS] SQS_QUEUE_URL is not set; SQS worker loop will NOT run in this container."
    );
    return;
  }

  console.log("[SQS] Starting SQS worker loop on queue:", QUEUE_URL);

  const WAIT_TIME_SECONDS = 20; // long polling
  const VISIBILITY_TIMEOUT = 300; // seconds
  const IDLE_DELAY_MS = 1000;

  while (true) {
    try {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: QUEUE_URL,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: WAIT_TIME_SECONDS,
          VisibilityTimeout: VISIBILITY_TIMEOUT,
        })
      );

      const messages = res.Messages || [];
      if (messages.length === 0) {
        // No messages, short sleep then poll again
        await sleep(IDLE_DELAY_MS);
        continue;
      }

      for (const msg of messages) {
        const receiptHandle = msg.ReceiptHandle;
        if (!msg.Body || !receiptHandle) {
          console.warn("[SQS] Received message without body or receiptHandle, skipping.");
          continue;
        }

        let payload: JobMessagePayload;
        try {
          payload = JSON.parse(msg.Body) as JobMessagePayload;
        } catch (err) {
          console.error("[SQS] Failed to parse message body, deleting. Body:", msg.Body);
          await safeDelete(receiptHandle);
          continue;
        }

        await processJobMessage(payload);

        // Delete message so it is not reprocessed
        await safeDelete(receiptHandle);
      }
    } catch (err) {
      console.error("[SQS] Error while polling/processing messages:", err);
      await sleep(IDLE_DELAY_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: process one job message
// ---------------------------------------------------------------------------
async function processJobMessage(payload: JobMessagePayload): Promise<void> {
  const { jobId, userId, inputKey, outputKey, ops } = payload;

  if (!jobId || !inputKey || !outputKey || !Array.isArray(ops) || ops.length === 0) {
    console.warn("[SQS] Invalid job payload, skipping:", payload);
    return;
  }

  const job = await getJobById(jobId);
  if (!job) {
    console.warn("[SQS] No job found in DynamoDB for jobId:", jobId);
    return;
  }

  if (job.userId && job.userId !== userId) {
    console.warn(
      `[SQS] Job user mismatch for jobId=${jobId}. Expected ${job.userId}, got ${userId}`
    );
  }

  // Move to processing (JobStatus union already includes "processing")
  await updateJob(jobId, {
    status: "processing",
  });

  try {
    console.log(
      `[SQS] Starting processing for jobId=${jobId} inputKey=${inputKey} outputKey=${outputKey}`
    );
    await runPipelineS3(inputKey, ops, outputKey);

    await updateJob(jobId, {
      status: "done",
      finishedAt: new Date().toISOString(),
    });

    console.log(`[SQS] Finished processing jobId=${jobId}`);
  } catch (err: any) {
    console.error("[SQS] Error processing jobId=", jobId, err);
    await updateJob(jobId, {
      status: "failed",
    });
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeDelete(receiptHandle: string): Promise<void> {
  try {
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: receiptHandle,
      })
    );
  } catch (err) {
    console.error("[SQS] Failed to delete message:", err);
  }
}
