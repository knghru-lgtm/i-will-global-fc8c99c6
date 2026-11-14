const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");

try {
  const root = join(__dirname, "..");
  const sarahServicePath = join(root, "server", "src", "services", "sarahVoiceService.ts");
  const sarahDialerPath = join(root, "server", "src", "services", "sarahDialer.ts");
  const telephonyPath = join(root, "server", "src", "services", "telephony.ts");
  const ecosystemPath = join(root, "ecosystem.config.cjs");
  const daemonWorkerPath = join(root, "cloud-voip-daemon", "worker.mjs");

  if (
    !existsSync(sarahServicePath) ||
    !existsSync(sarahDialerPath) ||
    !existsSync(telephonyPath) ||
    !existsSync(ecosystemPath) ||
    !existsSync(daemonWorkerPath)
  ) {
    throw new Error("Missing core Google Cloud + Google Voice Sarah files");
  }

  const forbiddenFiles = ["bland.json", ".bland", "render.yaml", "vercel.json", "neon.ts"];
  for (const f of forbiddenFiles) {
    if (existsSync(join(root, f))) {
      throw new Error(`Forbidden non-Google-Cloud file detected (${f}); repository must remain 100% Google Cloud + Google Voice`);
    }
  }

  const telephonySrc = readFileSync(telephonyPath, "utf8");
  if (/api\.twilio\.com/i.test(telephonySrc)) {
    throw new Error("Twilio API detected in telephony.ts; repository must remain 100% Google Cloud + Google Voice");
  }

  const combined =
    readFileSync(sarahServicePath, "utf8") +
    readFileSync(sarahDialerPath, "utf8") +
    telephonySrc +
    readFileSync(ecosystemPath, "utf8") +
    readFileSync(daemonWorkerPath, "utf8");
  const hash = createHash("sha256").update(combined).digest("hex");
  console.log(JSON.stringify({ valid: true, platform: "google-cloud-only", engine: "sarah-google-voice-native", hash }));
} catch (error) {
  console.error(JSON.stringify({ valid: false, code: "VALIDATION_FAILED", message: error.message }));
  process.exitCode = 1;
}
