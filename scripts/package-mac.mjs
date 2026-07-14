import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { findSecretLabels } from "./secret-patterns.mjs";

const root = resolve(import.meta.dirname, "..");
const packageInfo = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageInfo.version;
const targetArch = process.arch;
const electronApp = resolve(root, "node_modules/electron/dist/Electron.app");
const releaseDir = join(root, "release");
const appName = "研报笔记 Agent.app";
const appPath = join(releaseDir, appName);
const zipPath = join(releaseDir, `研报笔记-Agent-mac-${targetArch}.zip`);
const checksumPath = `${zipPath}.sha256`;
const desktopApp = join(homedir(), "Desktop", appName);
const desktopZip = join(homedir(), "Desktop", `研报笔记-Agent-mac-${targetArch}.zip`);
const iconPath = join(root, "assets", "app-icon.icns");
const copyToDesktop = process.argv.includes("--desktop") || process.env.COPY_TO_DESKTOP === "1";
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY || "-";

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    return statSync(fullPath).isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function assertSafePackage(resourcesApp) {
  const allowedTopLevel = new Set(["dist", "electron", "package.json"]);
  for (const entry of readdirSync(resourcesApp)) {
    if (!allowedTopLevel.has(entry)) throw new Error(`安装包包含未允许的应用资源：${entry}`);
  }
  for (const filePath of walk(resourcesApp)) {
    const relativePath = filePath.slice(resourcesApp.length + 1);
    const contents = readFileSync(filePath);
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    const labels = findSecretLabels(text);
    if (labels.length) {
      throw new Error(`安装包疑似包含敏感凭据（${labels.join("、")}）：${relativePath}`);
    }
  }
}

if (!existsSync(electronApp)) {
  throw new Error(`没有找到本机 Electron 运行时：${electronApp}`);
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
execFileSync("/usr/bin/ditto", [electronApp, appPath]);

const resourcesApp = join(appPath, "Contents", "Resources", "app");
rmSync(resourcesApp, { recursive: true, force: true });
mkdirSync(resourcesApp, { recursive: true });
cpSync(join(root, "dist"), join(resourcesApp, "dist"), { recursive: true });
cpSync(join(root, "electron"), join(resourcesApp, "electron"), { recursive: true });
writeFileSync(join(resourcesApp, "package.json"), JSON.stringify({
  name: "report-note-agent",
  version,
  productName: "研报笔记 Agent",
  main: "electron/main.cjs",
}, null, 2));
cpSync(iconPath, join(appPath, "Contents", "Resources", "app-icon.icns"));

const plist = join(appPath, "Contents", "Info.plist");
for (const [key, value] of [
  ["CFBundleDisplayName", "研报笔记 Agent"],
  ["CFBundleName", "研报笔记 Agent"],
  ["CFBundleIdentifier", "com.xixi.reportnoteagent"],
  ["CFBundleIconFile", "app-icon.icns"],
  ["LSApplicationCategoryType", "public.app-category.productivity"],
  ["CFBundleShortVersionString", version],
  ["CFBundleVersion", version],
]) {
  execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
}

for (const unusedPrivacyKey of [
  "NSAppTransportSecurity",
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
]) {
  try {
    execFileSync("/usr/bin/plutil", ["-remove", unusedPrivacyKey, plist]);
  } catch {
    // Electron's base Info.plist can change between releases; a missing key is safe.
  }
}

assertSafePackage(resourcesApp);
const signingArguments = ["--force", "--deep", "--sign", signingIdentity];
if (signingIdentity !== "-") signingArguments.push("--options", "runtime", "--timestamp");
signingArguments.push(appPath);
execFileSync("/usr/bin/codesign", signingArguments, { stdio: "inherit" });
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
rmSync(zipPath, { force: true });
rmSync(checksumPath, { force: true });
execFileSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath]);
writeFileSync(checksumPath, execFileSync("/usr/bin/shasum", ["-a", "256", zipPath], { encoding: "utf8" }));

console.log(`APP=${appPath}`);
console.log(`ZIP=${zipPath}`);
console.log(`SHA256=${checksumPath}`);

if (copyToDesktop) {
  rmSync(desktopApp, { recursive: true, force: true });
  rmSync(desktopZip, { force: true });
  execFileSync("/usr/bin/ditto", [appPath, desktopApp]);
  cpSync(zipPath, desktopZip);
  console.log(`DESKTOP_APP=${desktopApp}`);
  console.log(`DESKTOP_ZIP=${desktopZip}`);
}
