import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findSecretLabels, historyPatterns } from "./secret-patterns.mjs";

const root = resolve(import.meta.dirname, "..");

function git(args, { allowNoMatch = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (allowNoMatch && error.status === 1) return "";
    throw error;
  }
}

function isText(buffer) {
  return !buffer.includes(0);
}

function trackedFiles() {
  return git(["ls-files", "-z"]).split("\0").filter(Boolean);
}

const findings = [];
for (const relativePath of trackedFiles()) {
  const filePath = resolve(root, relativePath);
  let buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    continue;
  }
  if (!isText(buffer)) continue;
  const contents = buffer.toString("utf8");
  for (const label of findSecretLabels(contents)) findings.push(`${label}: ${relativePath}`);
}

const privateEnvFiles = trackedFiles().filter((file) => {
  const name = file.split("/").at(-1) || "";
  return name === ".env" || (name.startsWith(".env.") && !name.endsWith(".example"));
});
for (const file of privateEnvFiles) findings.push(`Tracked environment file: ${file}`);

const commits = git(["rev-list", "--all"]).trim().split("\n").filter(Boolean);
for (const commit of commits) {
  for (const { label, expression } of historyPatterns) {
    const matchedFiles = git(["grep", "-I", "-l", "-E", "-e", expression, commit, "--"], { allowNoMatch: true })
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const file of matchedFiles) findings.push(`${label} in git history ${commit.slice(0, 12)}: ${file}`);
  }
}

if (findings.length) {
  console.error("Public secret scan failed. No secret values are printed.");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Public secret scan passed: ${trackedFiles().length} tracked files, ${commits.length} reachable commits checked.`);
