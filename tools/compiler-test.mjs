import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createCompiler } from "../packages/compiler/src/index.ts";
import { runCompilerCorpus } from "../packages/compiler/test/corpus.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const start = performance.now();
const compiler = await createCompiler(pathToFileURL(resolve(root, "artifacts/compiler/")).href + "/");
const initialized = performance.now();
const cases = runCompilerCorpus(compiler);
const result = { environment: { runtime: process.version, platform: process.platform, architecture: process.arch },
  initializationMs: initialized - start, corpusMs: performance.now() - initialized, cases };
mkdirSync(resolve(root, "artifacts/compiler"), { recursive: true });
writeFileSync(resolve(root, "artifacts/compiler/corpus.json"), JSON.stringify(result, null, 2) + "\n");
for (const item of cases) console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name}${item.passed ? "" : ` ${item.log}`}`);
if (cases.some((item) => !item.passed)) process.exitCode = 1;
