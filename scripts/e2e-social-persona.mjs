import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const executable = process.env.APP_EXECUTABLE === "none"
  ? null
  : process.env.APP_EXECUTABLE || fileURLToPath(new URL("../release/研报笔记 Agent.app/Contents/MacOS/Electron", import.meta.url));
const baseUrl = process.env.APP_URL || "http://127.0.0.1:5180";
const reportPath = process.env.SOCIAL_REPORT;
if (!reportPath) throw new Error("请通过 SOCIAL_REPORT 指定测试用 PDF 路径");
const port = 9343;
const temp = executable ? mkdtempSync(join(tmpdir(), "xhs-social-persona-test-")) : null;
const app = executable
  ? spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(temp, "profile")}`], { stdio: "ignore" })
  : null;
let browser;

try {
  for (let attempt = 0; app && attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {
      // App 正在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = executable
    ? await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    : await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = executable
    ? browser.contexts()[0].pages()[0]
    : await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (!executable) await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles(reportPath);
  const outcome = await Promise.race([
    page.locator('[aria-label="文案与封面"]').waitFor({ timeout: 45_000 }).then(() => ({ kind: "ready" })),
    page.locator(".wizard-toast").waitFor({ timeout: 45_000 }).then(async () => ({ kind: "error", message: await page.locator(".wizard-toast").innerText() })),
  ]);
  if (outcome.kind === "error") throw new Error(`真实报告没有完成文案生成：${outcome.message}`);

  const titleOptions = await page.locator(".title-picks input").evaluateAll((inputs) => inputs.map((input) => input.value));
  const body = await page.locator(".copy-form textarea").inputValue();
  if (titleOptions.length !== 3) throw new Error(`标题数量错误：${titleOptions.length}`);
  if (titleOptions.some((title) => /行业报告解读/.test(title))) throw new Error(`仍出现通用标题：${titleOptions.join(" / ")}`);
  if (titleOptions.some((title) => !/圈层种草机|社交媒体/.test(title))) throw new Error(`标题偏离报告主标题：${titleOptions.join(" / ")}`);
  if (new Set(titleOptions).size !== 3) throw new Error("三条标题没有形成不同角度");
  const content = body.replace(/\n\s*(?:#[^\s#]+\s*){1,20}$/u, "").trim();
  const contentLength = Array.from(content.replace(/\s/g, "")).length;
  if (contentLength < 700 || contentLength > 800) throw new Error(`正文长度错误：${contentLength}`);
  if (/CONTENTS|目录|第[一二三四五六七八九十\d]+章|research@|报告合作|www\./i.test(body)) throw new Error("正文仍包含目录、章节、邮箱或网址");
  if (!/同一个人，不同平台人格|用户为什么打开|种草怎样发生/.test(body)) throw new Error("正文没有按社交人格主题重新分层");
  if (!["#社交媒体", "#用户洞察", "#平台运营", "#内容营销"].every((tag) => body.includes(tag))) throw new Error("标签没有围绕社交媒体人格主题生成");
  const platformMentions = ["dou音", "xiao红书", "bi哩bi哩", "bi站", "kuai手"].filter((platform) => body.includes(platform));
  if (platformMentions.length < 3) throw new Error(`不同平台的人格结论缺少主体：${platformMentions.join("、") || "无"}`);
  if (!/dou音[^\n]*转化型种草/.test(body) || !/xiao红书[^\n]*认知积累/.test(body) || !/bi站[^\n]*兴趣驱动/.test(body)) throw new Error(`平台人格结论与原报告的平台对应关系错误：${body}`);

  const coverImage = page.locator(".cover-editor img");
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(120);
  const alt = await coverImage.getAttribute("alt");
  if (!alt?.includes("社交媒体中的「圈层种草机」人格全解析")) throw new Error(`封面中文标题错误：${alt}`);
  await page.getByRole("button", { name: "暖纸刊" }).click();
  await page.waitForTimeout(120);
  await page.getByRole("button", { name: "雾紫刊" }).click();
  await page.waitForTimeout(120);
  const cover = await coverImage.getAttribute("src");
  if (!cover) throw new Error("封面没有生成");
  writeFileSync("/tmp/xhs-social-persona-cover.png", Buffer.from(cover.split(",")[1], "base64"));
  await page.getByRole("button", { name: "暖纸刊" }).click();
  await page.waitForTimeout(120);
  const paperCover = await coverImage.getAttribute("src");
  if (!paperCover) throw new Error("暖纸封面没有生成");
  writeFileSync("/tmp/xhs-social-persona-cover-paper.png", Buffer.from(paperCover.split(",")[1], "base64"));
  await page.getByRole("button", { name: "雾蓝刊" }).click();
  await page.waitForTimeout(120);
  const blueCover = await coverImage.getAttribute("src");
  if (!blueCover) throw new Error("雾蓝封面没有生成");
  writeFileSync("/tmp/xhs-social-persona-cover-blue.png", Buffer.from(blueCover.split(",")[1], "base64"));
  if (cover === paperCover || paperCover === blueCover || cover === blueCover) throw new Error("三套封面没有独立生成");
  await page.getByRole("button", { name: "雾紫刊" }).click();
  await page.screenshot({ path: "/tmp/xhs-social-persona-copy.png", fullPage: true });
  await page.getByRole("button", { name: /下一步：选择报告图片/ }).click();
  await page.locator('[data-asset-status="ready"]').waitFor({ timeout: 120_000 });
  await page.locator(".asset-card").first().click();
  await page.getByRole("button", { name: "下一步：最终审核" }).click();
  const finishButton = page.getByRole("button", { name: "导出内容包" });
  await finishButton.waitFor();
  if (await finishButton.isDisabled()) throw new Error("精简正文仍被旧字数门槛阻止完成导出");
  if (errors.length) throw new Error(`页面错误：${errors.join(" | ")}`);
  console.log(JSON.stringify({ titleOptions, contentLength, bodyPreview: content, coverAlt: alt, covers: ["/tmp/xhs-social-persona-cover.png", "/tmp/xhs-social-persona-cover-paper.png", "/tmp/xhs-social-persona-cover-blue.png"], screenshot: "/tmp/xhs-social-persona-copy.png", errors }, null, 2));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (app) app.kill("SIGTERM");
  if (temp) rmSync(temp, { recursive: true, force: true });
}
