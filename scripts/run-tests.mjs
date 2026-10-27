import { spawnSync } from "child_process";
import { build } from "esbuild";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = "/tmp/kami-fight-test.mjs";
const catalog = resolve(root, "public/catalog.js");

await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, "src/fight.test.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  banner: {
    js: `import { readFileSync as __read } from 'fs'; globalThis.window = globalThis; eval(__read(${JSON.stringify(catalog)}, 'utf8'));`,
  },
});

const python = "/Users/antho/Desktop/kamikoi-sim/.lz4venv/bin/python3";
const coverage = spawnSync(python, [resolve(root, "scripts/skill-coverage.py")], { stdio: "inherit" });
const run = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
process.exit(coverage.status || run.status || 0);
