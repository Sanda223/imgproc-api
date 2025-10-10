import "dotenv/config";
import express from "express";
import path from "path";
import { buildApp } from "./app";
import { loadConfig } from "./services/config";
import { initCognitoSecrets } from "./services/cognito.service";

async function main() {
  try {
    console.log("server: starting");

    // 1️⃣ Load AWS and Cognito configuration
    await loadConfig();
    console.log("server: config loaded");

    await initCognitoSecrets();
    console.log("server: cognito secret loaded");

    // 2️⃣ Build Express app (includes your API routes)
    const app = buildApp();

    // 3️⃣ Serve static files from /public (like main.js, CSS, etc.)
    app.use("/public", express.static(path.join(__dirname, "../public")));

    // 4️⃣ Page routes
    app.get("/", (_req, res) =>
      res.sendFile(path.join(__dirname, "../public/dashboard.html"))
    );

    app.get("/login", (_req, res) =>
      res.sendFile(path.join(__dirname, "../public/login.html"))
    );

    app.get("/signup", (_req, res) =>
      res.sendFile(path.join(__dirname, "../public/signup.html"))
    );

    app.get("/confirm", (_req, res) =>
      res.sendFile(path.join(__dirname, "../public/confirm.html"))
    );

    app.get("/dashboard", (_req, res) =>
      res.sendFile(path.join(__dirname, "../public/index.html"))
    );

    // 5️⃣ Safe fallback for all other unknown (non-API) routes
    // Use regex instead of "*" to avoid path-to-regexp errors
    app.get(/^(?!\/v1|\/public).*/, (_req, res) => {
      res.redirect("/login");
    });

    // 6️⃣ Start server
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`✅ API listening on http://localhost:${port}`);
    });
  } catch (err) {
    console.error("Fatal startup error:", err);
    process.exit(1);
  }
}

main();