import "dotenv/config";
import { buildApp } from "./app";
import { loadConfig } from "./services/config";
import { initCognitoSecrets } from "./services/cognito.service";

async function main() {
  try {
    console.log("server: starting");

    // 1) Load SSM Parameter Store values (S3/DDB)
    await loadConfig();
    console.log("server: config loaded");

    // 2) Load Cognito secrets from Secrets Manager (or env fallback)
    await initCognitoSecrets();
    console.log("server: cognito secret loaded");

    const app = buildApp();
    console.log("server: app built, about to listen");

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`API listening on http://localhost:${port}`);
    });
  } catch (err) {
    console.error("Fatal startup error:", err);
    process.exit(1);
  }
}

main();