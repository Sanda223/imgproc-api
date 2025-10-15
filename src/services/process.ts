import sharp from "sharp";
import { s3 } from "./s3.service";
import { Config } from "./config";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

type Op =
  | { op: "resize"; width: number; height: number }
  | { op: "blur"; sigma: number }
  | { op: "sharpen"; sigma?: number };

// helper: convert S3 stream → Buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (d: Buffer) => chunks.push(d));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function runSharpPipeline(inputBuf: Buffer, ops: Op[]) {
  let img = sharp(inputBuf, { failOn: "none" });
  for (const step of ops) {
    if (step.op === "resize") img = img.resize(step.width, step.height, { fit: "fill" });
    if (step.op === "blur") img = img.blur(step.sigma);
    if (step.op === "sharpen") img = img.sharpen(step.sigma);
  }
  return img.png().toBuffer();
}

async function writeOutputToS3(outputKey: string, outputBuf: Buffer) {
  const bucket = Config.S3_BUCKET;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: outputKey,
      Body: outputBuf,
      ContentType: "image/png",
    })
  );
}

/**
 * Run Sharp pipeline with raw Buffer input and upload the PNG result to S3.
 */
export async function runPipelineBuffer(inputBuf: Buffer, ops: Op[], outputKey: string) {
  const outputBuf = await runSharpPipeline(inputBuf, ops);
  await writeOutputToS3(outputKey, outputBuf);
  return { outputKey };
}

/**
 * Run Sharp pipeline with input stored in S3 (legacy seed flow).
 * @param inputKey - S3 key for input (e.g. "seed/seed.png")
 * @param ops - array of processing steps
 * @param outputKey - S3 key for output (e.g. "users/u1/jobs/j1/output.png")
 */
export async function runPipelineS3(inputKey: string, ops: Op[], outputKey: string) {
  const bucket = Config.S3_BUCKET; // ✅ now synchronous

  // 1) read input from S3
  const inputObj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: inputKey }));
  const inputBuf = await streamToBuffer(inputObj.Body as any);

  // 2+3) process and write output
  return runPipelineBuffer(inputBuf, ops, outputKey);
}
