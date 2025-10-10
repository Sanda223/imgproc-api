// src/routes/auth.routes.ts
import { Router } from "express";
import { cognitoSignUp, cognitoConfirm, cognitoLogin } from "../services/cognito.service";

const r = Router();

/**
 * POST /v1/auth/signup  { username, password, email }
 */
r.post("/signup", async (req, res, next) => {
  try {
    const { username, password, email } = req.body || {};
    if (!username || !password || !email) {
      return res.status(400).json({ error: { code: "bad_request", message: "username, password, email required" } });
    }
    await cognitoSignUp(username, password, email);
    res.status(201).json({ ok: true, message: "Sign-up initiated. Check your email for the confirmation code." });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /v1/auth/confirm  { username, code }
 */
r.post("/confirm", async (req, res, next) => {
  try {
    const { username, code } = req.body || {};
    if (!username || !code) {
      return res.status(400).json({ error: { code: "bad_request", message: "username and code required" } });
    }
    await cognitoConfirm(username, code);
    res.json({ ok: true, message: "Email confirmed. You can now log in." });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /v1/auth/login { username, password }
 * Returns: { token }  (IdToken from Cognito)
 */
r.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: { code: "bad_request", message: "username and password required" } });
    }
    const token = await cognitoLogin(username, password);
    res.json({ token });
  } catch (e) {
    next(e);
  }
});

export default r;