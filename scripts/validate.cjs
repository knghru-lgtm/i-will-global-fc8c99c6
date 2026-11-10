const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");

try {
  const root = join(__dirname, "..");
  const sarahServicePath = join(root, "server", "src", "services", "sarahVoiceService.ts");
  const sarahDialerPath = join(root, "server", "src", "services", "sarahDialer.ts");
  const vercelJsonPath = join(root, "vercel.json");

  if (!existsSync(sarahServicePath) || !existsSync(sarahDialerPath) || !existsSync(vercelJsonPath)) {
    throw new Error("Missing core Sarah Cloud Voice files");
  }
  if (existsSync(join(root, "bland.json")) || existsSync(join(root, ".bland"))) {
    throw new Error("Legacy Bland files detected; repository must remain 100% pure native Sarah Cloud Voice");
  }

  const combined =
    readFileSync(sarahServicePath, "utf8") +
    readFileSync(sarahDialerPath, "utf8") +
    readFileSync(vercelJsonPath, "utf8");
  const hash = createHash("sha256").update(combined).digest("hex");
  console.log(JSON.stringify({ valid: true, engine: "sarah-cloud-native", hash }));
} catch (error) {
  console.error(JSON.stringify({ valid: false, code: "VALIDATION_FAILED", message: error.message }));
  process.exitCode = 1;
}
