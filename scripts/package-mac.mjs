import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const electronApp = resolve(root, "node_modules/electron/dist/Electron.app");
const releaseDir = join(root, "release");
const appName = "研报笔记 Agent.app";
const appPath = join(releaseDir, appName);
const zipPath = join(releaseDir, "研报笔记-Agent-mac-arm64.zip");
const desktopApp = join(homedir(), "Desktop", appName);
const desktopZip = join(homedir(), "Desktop", "研报笔记-Agent-mac-arm64.zip");
const iconPath = join(root, "assets", "app-icon.icns");
const copyToDesktop = process.argv.includes("--desktop") || process.env.COPY_TO_DESKTOP === "1";

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
  version: "0.2.0",
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
  ["CFBundleShortVersionString", "0.2.0"],
  ["CFBundleVersion", "0.2.0"],
]) {
  execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
}

execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
rmSync(zipPath, { force: true });
execFileSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath]);

console.log(`APP=${appPath}`);
console.log(`ZIP=${zipPath}`);

if (copyToDesktop) {
  rmSync(desktopApp, { recursive: true, force: true });
  rmSync(desktopZip, { force: true });
  execFileSync("/usr/bin/ditto", [appPath, desktopApp]);
  cpSync(zipPath, desktopZip);
  console.log(`DESKTOP_APP=${desktopApp}`);
  console.log(`DESKTOP_ZIP=${desktopZip}`);
}
