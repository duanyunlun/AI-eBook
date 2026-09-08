import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const version = "v24.20.0";
const platform = process.platform === "win32" ? "win" : process.platform;
const arch = process.argv[2] || process.arch;
if (!["darwin", "linux", "win"].includes(platform) || !["arm64", "x64"].includes(arch)) throw new Error("不支持的 Node 打包目标");
const name = `node-${version}-${platform}-${arch}`;
const archive = `${name}.${platform === "win" ? "zip" : "tar.gz"}`;
const base = `https://nodejs.org/dist/${version}`;
const cache = resolve(".build-cache", name);
const target = resolve("src-tauri/runtime");
await mkdir(cache, { recursive: true });
async function download(name) {
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) throw new Error(`Node 下载失败：${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const checksums = (await download("SHASUMS256.txt")).toString();
const checksum = checksums.split("\n").map(line => line.trim().split(/\s+/)).find(parts => parts[1] === archive)?.[0];
if (!checksum) throw new Error("官方清单中没有目标 Node 包");
const archivePath = resolve(cache, archive);
const bytes = await readFile(archivePath).catch(() => download(archive));
if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("Node SHA256 校验失败");
await writeFile(archivePath, bytes);
execFileSync("tar", ["-xf", archivePath, "-C", cache]);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const extracted = resolve(cache, name);
await cp(resolve(extracted, platform === "win" ? "node.exe" : "bin/node"), resolve(target, platform === "win" ? "node.exe" : "node"));
await cp(resolve(extracted, platform === "win" ? "node_modules/npm" : "lib/node_modules/npm"), resolve(target, "npm"), { recursive: true });
await cp(resolve(extracted, "LICENSE"), resolve(target, "LICENSE-Node.txt"));
await writeFile(resolve(target, "version.json"), JSON.stringify({ version, platform, arch, archive, sha256: checksum }, null, 2));
if (arch === process.arch) {
  const node = resolve(target, platform === "win" ? "node.exe" : "node");
  if (execFileSync(node, ["--version"], { encoding: "utf8" }).trim() !== version) throw new Error("私有 Node 无法执行");
  execFileSync(node, [resolve(target, "npm/bin/npm-cli.js"), "--version"], { stdio: "inherit" });
}
console.log(`已准备并校验 ${name}`);
