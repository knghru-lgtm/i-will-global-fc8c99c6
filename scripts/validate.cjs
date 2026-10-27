const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {decode, contentHash} = require("../.bland/validator/index.js");
try {
  const {content} = decode({"bland.json": readFileSync(join(__dirname, "../bland.json"), "utf8")});
  console.log(JSON.stringify({valid: true, hash: contentHash(content)}));
} catch (error) {
  console.error(JSON.stringify({valid: false, code: error.code || "VALIDATION_FAILED", message: error.message}));
  process.exitCode = 1;
}
