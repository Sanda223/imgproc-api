// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import { verifyIdToken } from "../services/cognito.service";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const hdr = req.headers.authorization || "";
    if (!hdr.startsWith("Bearer ")) {
      return res.status(401).json({ error: { code: "unauthenticated", message: "Missing Bearer token" } });
    }
    const token = hdr.slice(7);
    const payload = await verifyIdToken(token);

    // Typical fields: sub, email, "cognito:username"
    (req as any).user = {
      sub: payload.sub,
      email: payload.email,
      username: (payload as any)["cognito:username"],
      payload,
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: { code: "invalid_token", message: "Invalid or expired token" } });
  }
}

