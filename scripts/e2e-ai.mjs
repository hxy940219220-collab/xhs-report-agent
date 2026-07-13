import { chromium } from "playwright-core";
import { appendFileSync, writeFileSync } from "node:fs";

const baseUrl = process.env.APP_URL || "http://127.0.0.1:5180";
const reportPath = process.env.HEALTH_REPORT;
if (!reportPath) throw new Error("请通过 HEALTH_REPORT 指定测试用 PDF 路径");
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
appendFileSync("/tmp/xhs-ai-steps.log", "browser\n");
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  let settings = { baseUrl: "https://api.example.com/v1", model: "demo-model", systemPrompt: "", hasApiKey: true };
  window.reportAgentAI = {
    getSettings: async () => settings,
    saveSettings: async (next) => (settings = { ...settings, ...next, hasApiKey: true }),
    testConnection: async () => ({ ok: true, latencyMs: 86, model: "demo-model", reply: "OK" }),
    clearKey: async () => (settings = { ...settings, hasApiKey: false }),
    generateCopy: async () => {
      let body = "📌 AI优化版：健康饮料市场正在从宽泛概念走向具体功能与日常场景。";
      const facts = [
        "▫️ 市场经历增长、调整与复苏，功能性饮料仍是软饮的重要增长方向。",
        "▫️ 消费者不再只看健康标签，也会核对配料、功能、口感与真实饮用场景。",
        "▫️ 能量补充与健康管理人群的年龄、性别和使用动机存在明显差异。",
        "▫️ 植物蛋白、膳食纤维、益生菌等成分正在成为产品差异化的重要依据。",
        "▫️ 无糖、低脂和高蛋白需求继续增长，但能否形成复购仍取决于产品体验。",
        "▫️ 通勤、运动、早餐和办公室场景正在推动饮料品类进一步细分。",
      ];
      let index = 0;
      while (Array.from(body.replace(/\s/g, "")).length < 720) {
        body += `\n\n${facts[index % facts.length]}`;
        index += 1;
      }
      return JSON.stringify({ titles: ["🥤2026健康饮料新趋势", "📈健康饮料增长信号", "🔍健康饮料消费变化"], body });
    },
  };
});
const page = await context.newPage();
await page.goto(baseUrl, { waitUntil: "networkidle" });
appendFileSync("/tmp/xhs-ai-steps.log", "goto\n");
await page.locator('input[type="file"]').setInputFiles(reportPath);
await page.locator('[aria-label="文案与封面"]').waitFor({ timeout: 60_000 });
appendFileSync("/tmp/xhs-ai-steps.log", "report\n");
await page.getByRole("button", { name: "AI 优化文案" }).click();
await page.getByRole("button", { name: "撤销 AI 优化" }).waitFor();
appendFileSync("/tmp/xhs-ai-steps.log", "generated\n");
const body = await page.locator(".copy-form > textarea").inputValue();
const content = body.replace(/\n\s*(?:#[^\s#]+\s*){1,20}$/u, "").trim();
const length = Array.from(content.replace(/\s/g, "")).length;
if (length < 680 || length > 900) throw new Error(`AI正文长度错误：${length}`);
if ((body.match(/#[^\s#]+/g) || []).length !== 10) throw new Error("AI文案没有重新附加10个行业标签");
await page.waitForTimeout(1100);
await page.reload({ waitUntil: "networkidle" });
await page.locator(".history-task").first().locator("button").first().click();
await page.locator('[aria-label="文案与封面"]').waitFor();
await page.getByRole("button", { name: "撤销 AI 优化" }).waitFor();
await page.getByRole("button", { name: "撤销 AI 优化" }).click();
await page.getByRole("button", { name: "撤销 AI 优化" }).waitFor({ state: "detached" });
appendFileSync("/tmp/xhs-ai-steps.log", "undo\n");

await page.getByRole("button", { name: "AI 接入设置" }).click();
await page.getByRole("heading", { name: "AI 接入设置" }).waitFor();
appendFileSync("/tmp/xhs-ai-steps.log", "settings\n");
const settingsPage = page.locator(".ai-settings-page");
await settingsPage.getByRole("button", { name: "测试 API 与模型" }).click();
await settingsPage.getByText(/连接成功/).waitFor();
await settingsPage.getByLabel("模型名称").fill("changed-after-test");
await settingsPage.getByRole("button", { name: "保存设置" }).click();
await settingsPage.getByText(/连接信息已变更，请先通过真实连接测试再保存/).waitFor();
await settingsPage.getByLabel("模型名称").fill("demo-model");
await settingsPage.getByRole("button", { name: "测试 API 与模型" }).click();
await settingsPage.getByText(/连接成功/).waitFor();
await page.screenshot({ path: "/tmp/xhs-ai-settings-page.png", fullPage: false });
const promptDetails = settingsPage.locator("details");
if (await promptDetails.getAttribute("open") !== null) throw new Error("系统提示词默认没有折叠");
await promptDetails.locator("summary").click();
const prompt = promptDetails.locator("textarea");
if (!/680–900/.test(await prompt.inputValue())) throw new Error("默认系统提示词缺少正文规则");
await prompt.fill(`${await prompt.inputValue()}\n补充要求：语言更自然。`);
appendFileSync("/tmp/xhs-ai-steps.log", "prompt-filled\n");
await page.getByRole("button", { name: "保存设置" }).click({ force: true });
appendFileSync("/tmp/xhs-ai-steps.log", "save-clicked\n");
appendFileSync("/tmp/xhs-ai-steps.log", "saved\n");

const result = { aiGenerated: true, contentLength: length, tags: 10, aiVersionPersisted: true, undoWorks: true, settingsVisible: true, connectionTestVisible: true, untestedChangesBlocked: true, promptCollapsedByDefault: true };
writeFileSync("/tmp/xhs-ai-result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await new Promise((resolve) => setTimeout(resolve, 200));
await browser.close();
