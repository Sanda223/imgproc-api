// src/services/secrets.ts
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = process.env.AWS_REGION || "ap-southeast-2";
const client = new SecretsManagerClient({ region: REGION });

let cache: Record<string, any> | null = null;

export async function loadSecrets() {
  if (cache) return cache;
  const out = await client.send(
    new GetSecretValueCommand({ SecretId: "/a2-n11594128/cognito" })
  );
  if (!out.SecretString) {
    throw new Error("Secrets Manager: empty SecretString for /a2-n11594128/cognito");
  }
  cache = JSON.parse(out.SecretString);
  console.log("Secrets loaded from Secrets Manager");
  return cache;
}

export function getSecret(key: string) {
  if (!cache) throw new Error("Secrets not loaded. Call loadSecrets() first.");
  return cache[key];
}