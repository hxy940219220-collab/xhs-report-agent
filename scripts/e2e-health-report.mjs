import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.APP_URL || "http://127.0.0.1:5180";
const reportPath = process.env.HEALTH_REPORT;
if (!reportPath) throw new Error("请通过 HEALTH_REPORT 指定测试用 PDF 路径");
const executable = process.env.APP_EXECUTABLE;
const port = 9342;
const temp = executable ? mkdtempSync(join(tmpdir(), "xhs-health-test-")) : null;
const app = executable
  ? spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(temp, "profile")}`], { stdio: "ignore" })
  : null;
if (app) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {
      // The packaged app is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
const browser = executable
  ? await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  : await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = executable
  ? browser.contexts()[0].pages()[0]
  : await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

if (!executable) await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(reportPath);
await page.locator('[aria-label="文案与封面"]').waitFor({ timeout: 60_000 });

const firstTitleInput = page.getByRole("textbox", { name: "标题方案 1", exact: true });
const title = await firstTitleInput.inputValue();
const titleOptions = await page.locator(".title-picks input").evaluateAll((inputs) => inputs.map((input) => input.value));
if (titleOptions.some((option) => Array.from(option).length > 20)) throw new Error(`可选标题超过20字：${titleOptions.join(" / ")}`);
const body = await page.locator(".copy-form textarea").inputValue();
const content = body.replace(/\n\s*(?:#[^\s#]+\s*){1,20}$/u, "").trim();
const contentLength = Array.from(content.replace(/\s/g, "")).length;
const tags = body.match(/#[^#\s]+/g) || [];
if (contentLength < 700 || contentLength > 800) throw new Error(`正文长度错误：${contentLength}`);
if (tags.length !== 10) throw new Error(`标签数量错误：${tags.length}`);
if (/P\.\s*\d+|第\s*\d+\s*页/.test(body)) throw new Error("发布正文中包含报告页码");
if (/姐妹们|家人们|救命|谁懂啊|首先|其次|最后/.test(body)) throw new Error("文案含禁用表达");
if (/适合谁快速看|怎么使用这份报告|完整报告还包含|一句话总结|分享一份行业报告|最近在看|内容很长|这个数字不是孤立|我不会只看最大的|赋能|助力|引领/.test(body)) throw new Error("文案仍含模板化、元话术或企业汇报腔表达");
if (/\d\s*…|预计\s*\d{0,3}\s*…|CAGR[^\n]{0,15}…/.test(body)) throw new Error("核心数据被截成残句");
if (/融入[^\n。；]{0,24}(?:饮食)?场(?:\n|$)/.test(body)) throw new Error("正文包含被截断的场景描述");
if (!/^🥤2026健康饮料：1700亿仍在增长$/.test(title)) throw new Error(`首选标题没有保留报告时间与主题：${title}`);
if (titleOptions.some((option) => /增长逻辑变了|重点看这3个变化|机会在哪/.test(option))) throw new Error("备选标题仍使用通用AI模板");
if (!titleOptions.every((option) => option.includes("2026")) || !titleOptions.some((option) => option.includes("新品类超40%")) || !titleOptions.some((option) => option.includes("97%近一年喝过"))) throw new Error(`备选标题没有保留报告时间或核心证据：${titleOptions.join(" / ")}`);
if (/18-30岁/.test(body) && !body.includes("健康管理型")) throw new Error(`细分人群数据丢失限定词：${body}`);
if (/25-35岁/.test(body) && !body.includes("能量补充型人群")) throw new Error(`能量补充型人群数据丢失限定词：${body}`);
if (/05 还有/.test(body)) throw new Error("文案仍包含机器兜底栏目");
if (/(?:^|\n)\s*[▫▪■]?\s*4%\s*(?:\n|功能饮料|运动蛋白饮料)/.test(body)) throw new Error("残缺的4%图表片段进入正文");
if (/数据来源[：:]\s*报告|我的理解[：:]|报告里的\s*\d+\s*个核心信号/.test(body)) throw new Error("旧版文案模板没有完成迁移");
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(100);
const compactLayout = await page.evaluate(() => ({
  viewport: window.innerHeight,
  documentHeight: document.documentElement.scrollHeight,
  nextBottom: document.querySelector(".topbar-primary")?.getBoundingClientRect().bottom ?? Infinity,
  coverBottom: document.querySelector(".cover-editor")?.getBoundingClientRect().bottom ?? Infinity,
}));
if (compactLayout.documentHeight > compactLayout.viewport + 1) throw new Error(`1280x800 创作台仍需整页滚动：${JSON.stringify(compactLayout)}`);
if (compactLayout.nextBottom > compactLayout.viewport || compactLayout.coverBottom > compactLayout.viewport) throw new Error(`1280x800 操作区或封面被遮挡：${JSON.stringify(compactLayout)}`);
await page.screenshot({ path: "/tmp/xhs-copy-1280x800.png", fullPage: false });
await page.setViewportSize({ width: 980, height: 680 });
await page.waitForTimeout(100);
const minimumWindowLayout = await page.evaluate(() => ({
  viewport: window.innerHeight,
  documentHeight: document.documentElement.scrollHeight,
  nextBottom: document.querySelector(".topbar-primary")?.getBoundingClientRect().bottom ?? Infinity,
  coverBottom: document.querySelector(".cover-editor")?.getBoundingClientRect().bottom ?? Infinity,
}));
if (minimumWindowLayout.documentHeight > minimumWindowLayout.viewport + 1) throw new Error(`980x680 最小窗口创作台仍需整页滚动：${JSON.stringify(minimumWindowLayout)}`);
if (minimumWindowLayout.nextBottom > minimumWindowLayout.viewport || minimumWindowLayout.coverBottom > minimumWindowLayout.viewport) throw new Error(`980x680 操作区或封面被遮挡：${JSON.stringify(minimumWindowLayout)}`);
if (await page.getByText(/查看\s*\d+\s*条事实来源/).count()) throw new Error("创作台仍显示事实来源入口");
await page.screenshot({ path: "/tmp/xhs-copy-980x680.png", fullPage: false });
await page.setViewportSize({ width: 1440, height: 1000 });
const coverImage = page.locator(".cover-editor img");
if (!((await coverImage.getAttribute("alt")) || "").includes("健康饮料市场消费趋势洞察")) throw new Error("封面没有使用去除来源后的报告原标题");
if (await page.locator(".cover-text-layer").count()) throw new Error("封面编辑框在默认预览态仍然可见");
await page.getByRole("button", { name: "点击编辑报告来源" }).click();
if (await page.locator(".cover-text-layer").count() !== 3) throw new Error("点击封面文字后没有进入编辑态");
const sourceEditor = page.getByLabel("编辑报告来源");
await sourceEditor.fill("来源：超长行业研究与消费趋势联合创新实验室年度专项中心");
for (const styleName of ["雾紫刊", "暖纸刊", "雾蓝刊"]) {
  await page.getByRole("button", { name: styleName }).click();
  await page.waitForTimeout(50);
  const sourceOverflow = await sourceEditor.evaluate((element) => element.scrollWidth - element.clientWidth);
  if (sourceOverflow > 2) throw new Error(`${styleName}长报告来源在自适应区域中溢出：${sourceOverflow}px`);
}
await page.screenshot({ path: "/tmp/xhs-cover-long-source-edit.png", fullPage: false });
await sourceEditor.fill("来源：炼丹炉");
await page.getByRole("button", { name: "雾紫刊" }).click();
await page.getByRole("button", { name: "编辑", exact: true }).click();
if (await page.locator(".cover-text-layer").count()) throw new Error("退出编辑后封面虚线框没有隐藏");
const coverDimensions = await coverImage.evaluate((image) => [image.naturalWidth, image.naturalHeight]);
if (coverDimensions[0] !== 1080 || coverDimensions[1] !== 1440) throw new Error(`封面尺寸错误：${coverDimensions.join("x")}`);
const lilacCover = await coverImage.getAttribute("src");
if (!lilacCover) throw new Error("雾紫封面没有生成");
await firstTitleInput.fill("临时修改的小红书标题");
await page.waitForTimeout(100);
if (await coverImage.getAttribute("src") !== lilacCover) throw new Error("修改小红书标题错误地改变了报告封面");
await firstTitleInput.fill(title);
writeFileSync("/tmp/xhs-health-cover-lilac-full.png", Buffer.from(lilacCover.split(",")[1], "base64"));
await coverImage.screenshot({ path: "/tmp/xhs-health-cover-redesign.png" });
await page.getByRole("button", { name: "暖纸刊" }).click();
const paperCover = await coverImage.getAttribute("src");
if (!paperCover) throw new Error("暖纸封面没有生成");
writeFileSync("/tmp/xhs-health-cover-paper-full.png", Buffer.from(paperCover.split(",")[1], "base64"));
await coverImage.screenshot({ path: "/tmp/xhs-health-cover-paper.png" });
await page.getByRole("button", { name: "雾蓝刊" }).click();
const blueCover = await coverImage.getAttribute("src");
if (!blueCover) throw new Error("雾蓝封面没有生成");
writeFileSync("/tmp/xhs-health-cover-blue-full.png", Buffer.from(blueCover.split(",")[1], "base64"));
await coverImage.screenshot({ path: "/tmp/xhs-health-cover-blue.png" });
if (lilacCover === paperCover || paperCover === blueCover || lilacCover === blueCover) throw new Error("三套封面没有生成独立视觉结果");
await page.getByRole("button", { name: "雾紫刊" }).click();
await page.getByRole("button", { name: "编辑", exact: true }).click();
const textLayers = page.locator(".cover-text-layer");
if (await textLayers.count() !== 3) throw new Error("封面没有显示三个直接编辑文字框");
const layerBackgrounds = await textLayers.evaluateAll((layers) => layers.map((layer) => getComputedStyle(layer).backgroundColor));
if (layerBackgrounds.some((color) => color !== "rgba(0, 0, 0, 0)")) throw new Error(`封面编辑框存在填充色：${layerBackgrounds.join(" / ")}`);
if (await page.getByLabel("编辑报告来源").inputValue() !== "来源：炼丹炉") throw new Error("报告来源不能在封面框内直接编辑");
if (!/健康饮料市场消费趋势洞察/.test(await page.getByLabel("编辑中文标题").inputValue())) throw new Error("中文标题不能在封面框内直接编辑");
await page.screenshot({ path: "/tmp/xhs-cover-direct-edit.png", fullPage: true });
await page.getByRole("button", { name: "编辑", exact: true }).click();
await page.screenshot({ path: "/tmp/xhs-health-copy-redesign.png", fullPage: true });

await page.getByRole("button", { name: /下一步：选择报告图片/ }).click();
await page.getByRole("heading", { name: "选择真正要发布的图片" }).waitFor();
await page.locator('[data-asset-status="ready"]').waitFor({ timeout: 120_000 });
const cards = page.locator(".asset-card");
const pageCount = await cards.count();
if (pageCount !== 42) throw new Error(`整页图片数量错误：${pageCount}`);
const firstLabel = await cards.first().innerText();
const lastLabel = await cards.last().innerText();
if (!/P\.1\b/.test(firstLabel) || !/P\.42\b/.test(lastLabel)) {
  throw new Error(`页面顺序错误：${firstLabel} / ${lastLabel}`);
}
const imageDimensions = async (card) => {
  await card.scrollIntoViewIfNeeded();
  const image = card.locator("img");
  await image.evaluate((element) => element.complete && element.naturalWidth > 0 || new Promise((resolve) => element.addEventListener("load", resolve, { once: true })));
  return image.evaluate((element) => [element.naturalWidth, element.naturalHeight]);
};
const firstDimensions = await imageDimensions(cards.first());
const lastDimensions = await imageDimensions(cards.last());
if ([firstDimensions, lastDimensions].some(([width, height]) => Math.max(width, height) < 1500)) throw new Error("首尾整页图片分辨率不足 1500px");
if (errors.length) throw new Error(`页面错误：${errors.join(" | ")}`);

console.log(JSON.stringify({ title, titleOptions, contentLength, bodyPreview: content, tags, coverDimensions, coverVariants: 3, pageCount, firstLabel, lastLabel, firstDimensions, lastDimensions, contains10_6: body.includes("10.6%"), contains2026: body.includes("2026"), errors }, null, 2));
await browser.close();
if (app) app.kill("SIGTERM");
if (temp) rmSync(temp, { recursive: true, force: true });
