// Post-build cleanup for static export.
//
// Next.js App Router emits per-route RSC navigation payloads (index.txt and
// __next.*.txt — roughly 8 files per page). For a static content site the
// HTML files are the real pages; these payloads only power soft client-side
// navigation, which falls back cleanly to normal page loads when absent.
//
// With 3,200+ airport pages they balloon the file count past Cloudflare
// Pages' 20,000-files-per-deployment limit, so we drop them here.
import { readdirSync, statSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "out");

function dirname(p) {
  return p.slice(0, p.lastIndexOf("/"));
}

let removed = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (
      entry === "index.txt" ||
      (basename(entry).startsWith("__next.") && entry.endsWith(".txt"))
    ) {
      rmSync(full);
      removed++;
    }
  }
}

try {
  walk(outDir);
  console.log(`prune-rsc: removed ${removed} RSC navigation payload files`);
} catch (err) {
  console.error("prune-rsc failed:", err.message);
  process.exit(1);
}
