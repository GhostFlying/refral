import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const pins = JSON.parse(readFileSync(resolve(root, "packages/compiler/dependencies.json"), "utf8"));
const directory = resolve(root, "artifacts/compiler");
mkdirSync(directory, { recursive: true });

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

const angleRoot = resolve(directory, "angle");
const marker = resolve(angleRoot, ".refral-revision");
if (!existsSync(marker) || readFileSync(marker, "utf8").trim() !== pins.angle.revision) {
  const archive = resolve(directory, "angle.tar.gz");
  run("curl", ["-L", "--fail", "--silent", "--show-error",
    `https://codeload.github.com/google/angle/tar.gz/${pins.angle.revision}`, "-o", archive]);
  mkdirSync(angleRoot, { recursive: true });
  run("tar", ["-xzf", archive, "-C", angleRoot, "--strip-components=1"]);
  writeFileSync(marker, `${pins.angle.revision}\n`);
}
const sdkRoot = resolve(directory, "emsdk");
if (!existsSync(resolve(sdkRoot, ".git"))) {
  run("git", ["clone", "--filter=blob:none", pins.emsdk.repository, sdkRoot]);
}
run("git", ["fetch", "--depth", "1", "origin", pins.emsdk.revision], sdkRoot);
run("git", ["checkout", "--detach", pins.emsdk.revision], sdkRoot);
run(resolve(sdkRoot, "emsdk"), ["install", pins.emsdk.sdkVersion]);
run(resolve(sdkRoot, "emsdk"), ["activate", pins.emsdk.sdkVersion]);
console.log(`Compiler dependencies ready at ${directory}`);
