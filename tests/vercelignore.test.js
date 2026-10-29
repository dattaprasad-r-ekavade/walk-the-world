import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ignore from "ignore";

// Guards against .vercelignore excluding a file that the Vercel build needs
// (next.config.mjs and the prebuild/build hooks). That mistake shows up on
// Vercel as MODULE_NOT_FOUND, so catch it locally.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTS = ["", ".js", ".mjs", ".cjs", ".json", "/index.js", "/index.mjs"];
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g;

function resolveLocal(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function reachable(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(c|m)?js$/.test(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const dep = resolveLocal(file, m[1]);
      if (dep) queue.push(dep);
    }
  }
  return [...seen];
}

function buildEntries() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const entries = [path.join(root, "next.config.mjs")];
  for (const name of ["prebuild", "build", "postbuild"]) {
    for (const token of (pkg.scripts?.[name] || "").split(/\s+/)) {
      if (/\.(c|m)?js$/.test(token)) {
        const file = path.join(root, token);
        expect(fs.existsSync(file), `${name} script references missing ${token}`).toBe(true);
        entries.push(file);
      }
    }
  }
  return entries;
}

const rel = (f) => path.relative(root, f).split(path.sep).join("/");

describe(".vercelignore", () => {
  const ig = ignore().add(fs.readFileSync(path.join(root, ".vercelignore"), "utf8"));

  it("does not exclude files needed by next.config.mjs or the build hooks", () => {
    const files = reachable(buildEntries()).map(rel);
    expect(files).toContain("next.config.mjs");
    expect(files.filter((f) => ig.ignores(f))).toEqual([]);
  });

  it("detects an ignored dependency (sanity check of the matcher)", () => {
    const bad = ignore().add("scripts/*");
    expect(bad.ignores("scripts/prebuilt-cell-revision.mjs")).toBe(true);
  });
});
