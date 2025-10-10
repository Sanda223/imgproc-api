// src/services/cognito.service.ts
import crypto from "crypto";
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { CognitoJwtVerifier } from "aws-jwt-verify";

const REGION = process.env.AWS_REGION || "ap-southeast-2";

// Pool + client id still come from env/SSM as you already have
const COG_POOL_ID = process.env.COG_POOL_ID!;
const COG_CLIENT_ID = process.env.COG_CLIENT_ID!;

// ----- Secrets Manager wiring -----
/**
 * We prefer to fetch the client secret from Secrets Manager.
 * Fallback to env if present (useful for local dev).
 */
const DEFAULT_SECRET_NAME = process.env.COGNITO_SECRET_NAME || "/a2-n11594128/cognito";
let COG_CLIENT_SECRET: string | "" = process.env.COG_CLIENT_SECRET || "";

export async function initCognitoSecrets(secretName = DEFAULT_SECRET_NAME) {
  // If already set (env/local), skip fetch.
  if (COG_CLIENT_SECRET) return;

  const sm = new SecretsManagerClient({ region: REGION });
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretName }));

  if (!res.SecretString) {
    throw new Error(`Secret ${secretName} has no SecretString`);
  }

  // When you create a secret with key/value pairs in the console, SecretString is JSON.
  try {
    const obj = JSON.parse(res.SecretString);
    COG_CLIENT_SECRET = obj.COG_CLIENT_SECRET || "";
  } catch {
    // If the secret is stored as a raw string, accept it directly
    COG_CLIENT_SECRET = res.SecretString;
  }

  if (!COG_CLIENT_SECRET) {
    throw new Error(
      `Secret ${secretName} does not contain COG_CLIENT_SECRET`
    );
  }
}

// ----- Cognito client -----
const cip = new CognitoIdentityProviderClient({ region: REGION });

// --- Sign up ---
export async function cognitoSignUp(username: string, password: string, email: string) {
  const cmd = new SignUpCommand({
    ClientId: COG_CLIENT_ID,
    Username: username,
    Password: password,
    SecretHash: COG_CLIENT_SECRET ? secretHash(username) : undefined,
    UserAttributes: [{ Name: "email", Value: email }],
  });
  return cip.send(cmd);
}

// --- Confirm sign up ---
export async function cognitoConfirm(username: string, code: string) {
  const cmd = new ConfirmSignUpCommand({
    ClientId: COG_CLIENT_ID,
    Username: username,
    ConfirmationCode: code,
    SecretHash: COG_CLIENT_SECRET ? secretHash(username) : undefined,
  });
  return cip.send(cmd);
}

// --- Login (USER_PASSWORD_AUTH) ---
export async function cognitoLogin(username: string, password: string) {
  const cmd = new InitiateAuthCommand({
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: COG_CLIENT_ID,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
      ...(COG_CLIENT_SECRET ? { SECRET_HASH: secretHash(username) } : {}),
    },
  });

  const out = await cip.send(cmd);
  const idToken = out.AuthenticationResult?.IdToken;
  if (!idToken) {
    throw new Error("Login failed: no IdToken returned from Cognito");
  }
  return idToken;
}

// ---- ID token verifier (cache the verifier instance) ----
const idTokenVerifier = CognitoJwtVerifier.create({
  userPoolId: COG_POOL_ID,
  tokenUse: "id",
  clientId: COG_CLIENT_ID,
});

export async function verifyIdToken(token: string) {
  return idTokenVerifier.verify(token);
}

// ---- Helper (only if your app client uses secret) ----
function secretHash(username: string) {
  if (!COG_CLIENT_SECRET) return undefined;
  const hmac = crypto.createHmac("sha256", COG_CLIENT_SECRET);
  hmac.update(username + COG_CLIENT_ID);
  return hmac.digest("base64");
}