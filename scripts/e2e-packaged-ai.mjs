import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const executable = process.env.APP_EXECUTABLE || fileURLToPath(new URL("../release/研报笔记 Agent.app/Contents/MacOS/Electron", import.meta.url));
const reportPath = process.env.HEALTH_REPORT;
if (!reportPath) throw new Error("请通过 HEALTH_REPORT 指定测试用 PDF 路径");
const resultPath = "/tmp/xhs-packaged-ai-result.json";
const require = createRequire(import.meta.url);
const { providerChatOptions } = require("../electron/ai-request-options.cjs");
if (providerChatOptions("api.siliconflow.cn", "deepseek-ai/DeepSeek-V4-Flash").enable_thinking !== false) throw new Error("硅基流动 V4 Flash 没有关闭思考模式");
if (Object.keys(providerChatOptions("api.siliconflow.cn", "deepseek-ai/DeepSeek-V3.2")).length) throw new Error("非 V4 模型被错误注入 V4 参数");
if (Object.keys(providerChatOptions("example.com", "deepseek-ai/DeepSeek-V4-Flash")).length) throw new Error("自定义服务被错误注入硅基流动参数");
rmSync(resultPath, { force: true });
const watchdog = setTimeout(() => {
  console.error("[packaged-ai] 测试超过 150 秒，强制结束");
  process.exit(1);
}, 150_000);
const freePort = async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
};
const apiPort = await freePort();
const debugPort = await freePort();
let testRequestVerified = false;
const connectionTestModels = [];
let generationRequestVerified = false;
let generationStreamVerified = false;
let generationRequestCount = 0;
let generationClientClosedAfterDone = 0;
const generationRequestChecks = [];
const server = createServer((request, response) => {
  let payload = "";
  request.on("data", (chunk) => { payload += chunk; });
  request.on("end", () => {
    const parsed = JSON.parse(payload || "{}");
    const validRequest = request.url === "/v1/chat/completions"
      && request.headers.authorization === "Bearer local-test-key"
      && ["local-test-model", "local-test-model-v2"].includes(parsed.model)
      && Array.isArray(parsed.messages);
    const isConnectionTest = parsed.messages?.length === 1 && /连接测试/.test(parsed.messages[0]?.content || "");
    if (isConnectionTest) {
      testRequestVerified = validRequest && parsed.stream === true && parsed.max_tokens === 64;
      if (testRequestVerified) connectionTestModels.push(parsed.model);
    }
    else {
      generationRequestCount += 1;
      generationRequestVerified = validRequest;
      generationStreamVerified = validRequest && parsed.stream === true && parsed.max_tokens === 2400;
      generationRequestChecks.push(generationStreamVerified);
    }
    if (isConnectionTest) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ model: parsed.model, choices: [{ message: { content: "OK" } }] }));
      return;
    }
    let body = "首先，📌 健康饮料消费正在从宽泛健康概念走向具体功能和真实场景。\n\n数据来源：报告 P.23\n\n📈【市场变化】\n▫️ 某细分品类增长9876%，值得关注。\n▫️ 商品目录正在成为新品入口。\n\n👤【消费选择】\n▫️ 消费者同时关注配料、功能、口感和复购体验。\n▫️ P90用户是值得关注的高频群体。\n\n🧩【场景机会】\n▫️ 最后一公里配送决定履约体验。\n\n💬 我的判断\n首先，看清需求再做产品。";
    const fact = "\n▫️ 产品差异化需要落到明确需求，功能表达也要对应真实饮用场景。";
    const requestedLength = generationRequestCount === 1 ? 445 : 600;
    while (Array.from(body.replace(/\s/g, "")).length < requestedLength) body += fact;
    const generated = JSON.stringify({ titles: ["🥤2026健康饮料新趋势", "📈健康饮料增长信号", "🔍健康饮料消费变化"], body });
    const splitAt = Math.floor(generated.length / 2);
    setTimeout(async () => {
      response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
      // Reasoning-capable providers can stream megabytes of reasoning_content before
      // the final copy. The app must ignore it instead of rejecting the useful result.
      for (let index = 0; index < 24; index += 1) {
        const event = `data: ${JSON.stringify({ model: "local-test-model", choices: [{ delta: { reasoning_content: "思".repeat(30_000) } }] })}\n\n`;
        if (!response.write(event)) await once(response, "drain");
      }
      const firstEvent = Buffer.from(`data: ${JSON.stringify({ model: "local-test-model", choices: [{ delta: { content: generated.slice(0, splitAt) } }] })}\n\n`);
      const chineseBytes = Buffer.from("健康");
      const chineseAt = firstEvent.indexOf(chineseBytes);
      const byteSplit = chineseAt >= 0 ? chineseAt + 1 : Math.floor(firstEvent.length / 3);
      response.write(firstEvent.subarray(0, byteSplit));
      response.write(firstEvent.subarray(byteSplit, byteSplit + 5));
      response.write(firstEvent.subarray(byteSplit + 5));
      setTimeout(() => {
        response.once("close", () => { generationClientClosedAfterDone += 1; });
        response.write(`data: ${JSON.stringify({ model: "local-test-model", choices: [{ delta: { content: generated.slice(splitAt) } }] })}\n\ndata: [DONE]\n\n`);
        // Deliberately keep the HTTP response open. The client must stop at [DONE].
      }, 150);
    }, 1_200);
  });
});
await new Promise((resolve) => server.listen(apiPort, "127.0.0.1", resolve));

const temp = mkdtempSync(join(tmpdir(), "xhs-packaged-ai-"));
const app = spawn(executable, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(temp, "profile")}`], { stdio: "ignore" });
let browser;
let completed = false;
let appExit = null;
const mark = (message) => console.error(`[packaged-ai] ${message}`);
app.once("exit", (code, signal) => { appExit = { code, signal }; });
app.once("error", (error) => { appExit = { error: error.message }; });
try {
  let debugReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) { debugReady = true; break; } } catch { /* App is starting. */ }
    if (appExit) throw new Error(`桌面 App 在调试端口就绪前退出：${JSON.stringify(appExit)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!debugReady) throw new Error("桌面 App 调试端口未在 16 秒内就绪");
  mark("桌面端调试连接就绪");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("button", { name: "AI 接入设置" }).click();
  mark("已打开 AI 设置");
  const panel = page.locator(".ai-settings-page");
  const expectedProviders = [
    ["硅基流动", "https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-V4-Flash"],
    ["DeepSeek", "https://api.deepseek.com", "deepseek-chat"],
    ["千问百炼", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"],
    ["Kimi", "https://api.moonshot.cn/v1", "kimi-k2.6"],
    ["智谱 GLM", "https://open.bigmodel.cn/api/paas/v4", "glm-5.1"],
    ["MiniMax", "https://api.minimaxi.com/v1", "MiniMax-M2.7"],
    ["小米 MiMo", "https://api.xiaomimimo.com/v1", "mimo-v2.5-pro"],
    ["OpenAI", "https://api.openai.com/v1", "gpt-5-mini"],
  ];
  for (const [label, url, model] of expectedProviders) {
    await panel.getByRole("radio", { name: new RegExp(label) }).click();
    if (await panel.getByLabel("接口地址").inputValue() !== url) throw new Error(`${label} 预设地址错误`);
    if (await panel.getByLabel("模型名称").inputValue() !== model) throw new Error(`${label} 建议模型错误`);
  }
  await page.screenshot({ path: "/tmp/xhs-ai-provider-presets.png", fullPage: true });
  await panel.getByRole("radio", { name: /自定义/ }).click();
  if (await panel.getByLabel("接口地址").inputValue() || await panel.getByLabel("模型名称").inputValue()) throw new Error("自定义预设没有清空可编辑字段");
  await panel.getByLabel("接口地址").fill(`http://127.0.0.1:${apiPort}/v1`);
  await panel.getByLabel("模型名称").fill("local-test-model");
  await panel.getByLabel("API Key").fill("local-test-key");
  await panel.getByRole("button", { name: "测试 API 与模型" }).click();
  await panel.getByText(/连接成功/).waitFor({ timeout: 35_000 });
  mark("连接测试通过");
  if (!testRequestVerified) throw new Error("测试按钮没有真实请求所填 API 和模型");
  await page.waitForFunction(() => {
    const button = document.querySelector(".save-ai");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, { timeout: 5_000 });
  await panel.getByRole("button", { name: "保存设置" }).evaluate((button) => button.click());
  await page.waitForTimeout(500);
  mark("设置已加密保存");
  const locateSettings = (directory) => {
    if (!existsSync(directory)) return null;
    for (const name of readdirSync(directory)) {
      const candidate = join(directory, name);
      if (name === "ai-settings.json") return candidate;
      let stats;
      try {
        stats = lstatSync(candidate);
      } catch {
        continue;
      }
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        const nested = locateSettings(candidate);
        if (nested) return nested;
      }
    }
    return null;
  };
  const settingsFile = locateSettings(temp);
  if (!settingsFile) throw new Error("没有找到桌面端保存的 AI 配置文件");
  const storedSettings = readFileSync(settingsFile, "utf8");
  if (!/"encryptedKey"\s*:\s*"[^"]+"/.test(storedSettings) || storedSettings.includes("local-test-key")) throw new Error("API Key 没有以加密形式保存");
  const keyField = panel.getByLabel("API Key");
  if (!await keyField.isDisabled()) throw new Error("已有 Key 时输入框没有锁定，切换模型可能误触发钥匙串写入");
  await panel.getByLabel("模型名称").fill("local-test-model-v2");
  await panel.getByRole("button", { name: "测试 API 与模型" }).click();
  await panel.getByText(/连接成功 · local-test-model-v2/).waitFor({ timeout: 65_000 });
  await page.waitForFunction(() => {
    const button = document.querySelector(".save-ai");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, { timeout: 5_000 });
  await panel.getByRole("button", { name: "保存设置" }).evaluate((button) => button.click());
  await page.waitForTimeout(400);
  if (connectionTestModels.join(",") !== "local-test-model,local-test-model-v2") throw new Error(`模型切换没有复用已保存 Key：${connectionTestModels.join(",")}`);
  mark("同一 Key 下模型切换已保存");
  await panel.getByRole("button", { name: "返回工作区" }).click();
  await page.locator('input[type="file"]').setInputFiles(reportPath);
  await page.locator('[aria-label="文案与封面"]').waitFor({ timeout: 60_000 });
  mark("报告解析完成");
  const originalBody = await page.locator(".copy-form > textarea").inputValue();
  await page.getByRole("button", { name: "AI 优化文案" }).click();
  await page.locator(".ai-generation-overlay").waitFor({ timeout: 2_000 });
  if (await page.locator(".copy-form > textarea").inputValue() !== originalBody) throw new Error("AI 请求刚开始就提前覆盖了原文");
  const motion = await page.locator(".ai-generation-overlay").evaluate((overlay) => {
    const orbit = getComputedStyle(overlay.querySelector(".ai-proofing-mark span"));
    const scan = getComputedStyle(overlay.querySelector(".ai-proofing-track span"));
    return { orbit: orbit.animationName, orbitDuration: orbit.animationDuration, scan: scan.animationName, scanDuration: scan.animationDuration };
  });
  if (motion.orbit === "none" || motion.scan === "none" || motion.orbitDuration === "0s" || motion.scanDuration === "0s") throw new Error("AI 生成状态存在但动效没有运行");
  await page.getByText(/已等待 [1-9]\d* 秒/).waitFor({ timeout: 3_000 });
  await page.getByText(/长度自动校准 · 第 2 步/).waitFor({ timeout: 5_000 });
  if (await page.locator(".copy-form > textarea").inputValue() !== originalBody) throw new Error("长度校准期间提前覆盖了原文");
  await page.screenshot({ path: "/tmp/xhs-ai-generation-overlay.png" });
  mark("生成动效已显示");
  await page.getByRole("button", { name: "撤销 AI 优化" }).waitFor({ timeout: 100_000 });
  if (await page.locator(".ai-generation-overlay").count()) throw new Error("AI 完成后生成遮罩没有移除");
  mark("流式文案生成完成");
  const value = await page.locator(".copy-form > textarea").inputValue();
  if (value === originalBody) throw new Error("AI 流程提示成功，但正文仍是原规则稿");
  const contentLength = Array.from(value.replace(/\n\s*(?:#[^\s#]+\s*){1,20}$/u, "").replace(/\s/g, "")).length;
  if (!generationRequestVerified) throw new Error("桌面端没有按配置调用第三方兼容接口");
  if (!generationStreamVerified) throw new Error("AI 文案没有使用流式请求和受控输出长度");
  if (generationRequestChecks.length !== 2 || !generationRequestChecks.every(Boolean)) throw new Error(`两次生成请求并非都使用正确的鉴权、模型和流式参数：${JSON.stringify(generationRequestChecks)}`);
  if (generationRequestCount !== 2) throw new Error(`短文没有触发且仅触发一次自动校准：${generationRequestCount} 次生成请求`);
  if (generationClientClosedAfterDone !== 2) throw new Error("两次生成收到 SSE [DONE] 后没有立即停止等待连接");
  if (contentLength < 680 || contentLength > 900) throw new Error(`桌面端AI正文长度错误：${contentLength}`);
  const titles = await page.locator(".title-pick-row input").evaluateAll((inputs) => inputs.map((input) => input.value));
  if (titles.length !== 3 || titles[0] !== "🥤2026健康饮料新趋势") throw new Error(`AI 标题没有正确落入 3 个标题栏：${JSON.stringify(titles)}`);
  const tags = value.match(/#[^\s#]+/gu) ?? [];
  if (tags.length !== 10 || !value.includes("健康饮料消费正在从宽泛健康概念走向具体功能")) throw new Error("AI 有效正文或 10 个标签没有完整落入编辑区");
  if (/(?:首先|数据来源|P\.?\s*23|9876%)/i.test(value)) throw new Error("目录、页码、来源或未落地数据没有被自动清洗");
  if (/我的判断|我认为|在我看来|个人观点/.test(value) || !value.includes("🔭【趋势信号】")) throw new Error("AI 文案没有转换为客观趋势收尾");
  if (!/📈【市场变化】[\s\S]*\n\n👤【消费选择】/.test(value)) throw new Error("AI 文案的模块标题或段落空行被后处理压平");
  if ((value.match(/\p{Extended_Pictographic}/gu) ?? []).length < 5) throw new Error("AI 文案缺少适量 emoji 视觉引导");
  if (!value.includes("商品目录正在成为新品入口") || !value.includes("最后一公里配送") || !value.includes("P90用户")) throw new Error("合法的目录语义、最后一公里或P90术语被误删");
  const repeatedMockSentence = value.match(/消费者同时关注配料、功能、口感和复购体验/g) ?? [];
  if (repeatedMockSentence.length > 1) throw new Error(`长度补足保留了重复凑字句：${repeatedMockSentence.length} 次`);
  const result = { ipcBridge: true, encryptedSettingsSaved: true, providerPresets: expectedProviders.length + 1, generationMotion: motion, connectionTestRequest: true, thirdPartyRequest: true, streamingGeneration: true, automaticLengthRepair: generationRequestCount, stopsAtDone: true, titles, tagCount: tags.length, contentLength };
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
  completed = true;
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (!appExit) app.kill("SIGTERM");
  for (let attempt = 0; attempt < 20 && !appExit; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!appExit) {
    app.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await new Promise((resolve) => {
    const fallback = setTimeout(resolve, 1_000);
    server.close(() => { clearTimeout(fallback); resolve(); });
    server.closeAllConnections?.();
  });
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
if (!completed || !existsSync(resultPath)) throw new Error("桌面端 AI 测试未完成，未生成新的测试结果");
clearTimeout(watchdog);
