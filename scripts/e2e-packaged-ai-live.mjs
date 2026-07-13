import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const upstreamKey = process.env.LIVE_SILICONFLOW_API_KEY;
if (!upstreamKey) throw new Error("缺少 LIVE_SILICONFLOW_API_KEY；只允许通过当前进程环境临时传入");

const executable = process.env.APP_EXECUTABLE || fileURLToPath(new URL("../release/研报笔记 Agent.app/Contents/MacOS/Electron", import.meta.url));
const reportPath = process.env.HEALTH_REPORT;
if (!reportPath) throw new Error("请通过 HEALTH_REPORT 指定测试用 PDF 路径");
const freePort = async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
};
const apiPort = await freePort();
const debugPort = await freePort();
let upstreamRequests = 0;
const proxy = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", async () => {
    try {
      if (request.url !== "/v1/chat/completions" || request.headers.authorization !== "Bearer local-live-test") {
        response.writeHead(401).end();
        return;
      }
      const body = JSON.parse(raw || "{}");
      upstreamRequests += 1;
      const upstream = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${upstreamKey}` },
        body: JSON.stringify({ ...body, model: "deepseek-ai/DeepSeek-V4-Flash", enable_thinking: false }),
        signal: AbortSignal.timeout(190_000),
      });
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
      const reader = upstream.body?.getReader();
      if (!reader) {
        response.end();
        return;
      }
      response.once("close", () => reader.cancel().catch(() => undefined));
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!response.write(Buffer.from(value))) await once(response, "drain");
      }
      response.end();
    } catch (error) {
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "proxy failed" } }));
    }
  });
});
await new Promise((resolve) => proxy.listen(apiPort, "127.0.0.1", resolve));

const temp = mkdtempSync(join(tmpdir(), "xhs-live-ai-"));
const childEnv = { ...process.env };
delete childEnv.LIVE_SILICONFLOW_API_KEY;
const app = spawn(executable, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(temp, "profile")}`], { stdio: "ignore", env: childEnv });
let browser;
let appExit = null;
app.once("exit", (code, signal) => { appExit = { code, signal }; });
try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break; } catch { /* starting */ }
    if (appExit) throw new Error(`App 提前退出：${JSON.stringify(appExit)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("button", { name: "AI 接入设置" }).click();
  const panel = page.locator(".ai-settings-page");
  await panel.getByRole("radio", { name: /自定义/ }).click();
  await panel.getByLabel("接口地址").fill(`http://127.0.0.1:${apiPort}/v1`);
  await panel.getByLabel("模型名称").fill("deepseek-ai/DeepSeek-V4-Flash");
  await panel.getByLabel("API Key").fill("local-live-test");
  await panel.getByRole("button", { name: "测试 API 与模型" }).click();
  await panel.getByText(/连接成功/).waitFor({ timeout: 70_000 });
  await panel.getByRole("button", { name: "保存设置" }).click();
  await page.waitForTimeout(400);
  await panel.getByRole("button", { name: "返回工作区" }).click();
  await page.locator('input[type="file"]').setInputFiles(reportPath);
  await page.locator('[aria-label="文案与封面"]').waitFor({ timeout: 70_000 });
  const bodyField = page.locator(".copy-form > textarea");
  const originalBody = await bodyField.inputValue();
  const originalTitles = await page.locator(".title-pick-row input").evaluateAll((inputs) => inputs.map((input) => input.value));
  await page.getByRole("button", { name: "AI 优化文案" }).click();
  await page.getByRole("button", { name: "撤销 AI 优化" }).waitFor({ timeout: 230_000 });
  const body = await bodyField.inputValue();
  const titles = await page.locator(".title-pick-row input").evaluateAll((inputs) => inputs.map((input) => input.value));
  const content = body.replace(/\n\s*(?:#[^\s#]+\s*){1,20}$/u, "");
  const bodyChars = Array.from(content.replace(/\s/g, "")).length;
  const tags = body.match(/#[^\s#]+/gu) ?? [];
  if (body === originalBody) throw new Error("真实 API 返回后正文仍未替换");
  if (titles.length !== 3 || titles.some((title) => !title.trim() || Array.from(title).length > 20)) throw new Error("真实 API 返回后的 3 个标题不完整");
  if (bodyChars < 680 || bodyChars > 900) throw new Error(`替换后的正文长度错误：${bodyChars}`);
  if (new Set(tags).size !== 10) throw new Error(`替换后的标签数量错误：${new Set(tags).size}`);
  if (/(?:CONTENTS|数据来源|报告\s*P\.?\s*\d+|https?:\/\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i.test(content)) throw new Error("替换后的正文仍含结构噪音");
  const result = { replaced: true, titlesValid: true, titlesChanged: JSON.stringify(titles) !== JSON.stringify(originalTitles), bodyChars, tagCount: new Set(tags).size, upstreamRequests };
  writeFileSync("/tmp/xhs-packaged-ai-live-result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (!appExit) app.kill("SIGTERM");
  for (let attempt = 0; attempt < 20 && !appExit; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!appExit) app.kill("SIGKILL");
  await new Promise((resolve) => {
    const fallback = setTimeout(resolve, 1_000);
    proxy.close(() => { clearTimeout(fallback); resolve(); });
    proxy.closeAllConnections?.();
  });
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
