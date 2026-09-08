import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { readFileSync } from "node:fs";

const node = resolve("src-tauri/runtime", process.platform === "win32" ? "node.exe" : "node");
const manifest = JSON.parse(readFileSync("plugins/dsh-reader/package.json", "utf8"));
const version = manifest.aiEbook.dshVersions[0];
if (!/^[\w.+-]+$/.test(version)) throw new Error("DSH 测试版本无效");
const options = { stdio: "inherit", timeout: 240000, env: { ...process.env, PATH: resolve("src-tauri/runtime") + delimiter + (process.env.PATH || "") } };
execFileSync(node, [resolve("src-tauri/runtime/npm/bin/npm-cli.js"), "install", "--prefix", resolve(".npm-cache/dsh-runtime"), "--cache", resolve(".npm-cache/npm"), "--no-audit", "--no-fund", "--omit=dev", `@deepseek-ai/dsh@${version}`], options);
execFileSync(node, ["--test", "plugins/dsh-reader/integration.test.mjs"], options);
