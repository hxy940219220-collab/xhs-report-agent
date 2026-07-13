import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const executable = process.env.APP_EXECUTABLE || fileURLToPath(new URL("../release/研报笔记 Agent.app/Contents/MacOS/Electron", import.meta.url));
const port = 9341;
const fixturePages = Math.max(1, Math.min(120, Number(process.env.PDF_TEST_PAGES || 48)));
const temp = mkdtempSync(join(tmpdir(), "xhs-packaged-test-"));
const pdfPath = join(temp, "electron-compatibility.pdf");

function createPdf(path) {
  const lines = Array.from({ length: 8 }, (_, index) => `Industry report line ${index + 1}: market demand, user behavior, growth trends, and practical business insights.`);
  const stream = `q 300 0 0 200 156 300 cm /Im1 Do Q BT /F1 11 Tf 54 740 Td ${lines.map((line, index) => `${index ? "0 -18 Td " : ""}(${line}) Tj`).join(" ")} ET`;
  const fontObject = 3 + fixturePages * 2;
  const imageObject = fontObject + 1;
  const pageRefs = Array.from({ length: fixturePages }, (_, index) => `${3 + index * 2} 0 R`).join(" ");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pageRefs}] /Count ${fixturePages} >>`];
  for (let index = 0; index < fixturePages; index += 1) {
    const contentObject = 4 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> /XObject << /Im1 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const imageBytes = "\0".repeat(300 * 200 * 3);
  objects.push(`<< /Type /XObject /Subtype /Image /Width 300 /Height 200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${imageBytes.length} >>\nstream\n${imageBytes}\nendstream`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(path, pdf);
}

async function waitForDebugPort() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // The packaged app is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("桌面 App 调试端口未就绪");
}

createPdf(pdfPath);
const app = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(temp, "profile")}`], { stdio: ["ignore", "pipe", "pipe"] });
let browser;
try {
  await waitForDebugPort();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const startedAt = performance.now();
  await page.locator('input[type="file"]').setInputFiles(pdfPath);
  try {
    await page.locator('[aria-label="文案与封面"]').waitFor({ timeout: 60000 });
  } catch (error) {
    throw new Error(`桌面包没有完成 PDF 解析：${(await page.locator("body").innerText()).slice(-500)}`, { cause: error });
  }
  const body = await page.locator("body").innerText();
  if (body.includes("toHex is not a function") || pageErrors.some((error) => error.includes("toHex"))) throw new Error("桌面包仍缺少 Uint8Array.toHex 兼容支持");
  const textReadyMs = Math.round(performance.now() - startedAt);
  if (fixturePages >= 48 && textReadyMs > 2500) throw new Error(`长报告文字首屏超过冷启动性能预算：${textReadyMs}ms`);
  const backgroundVisibleAtTextReady = await page.locator(".background-task").isVisible().catch(() => false);
  if (fixturePages >= 48 && !backgroundVisibleAtTextReady) throw new Error("48 页文案首屏没有与图片后台任务解耦");
  await page.getByRole("button", { name: /下一步：选择报告图片/ }).click();
  await page.locator('[data-asset-status="ready"]').waitFor({ timeout: 60000 });
  if (await page.locator('[data-asset-status="error"]').count()) throw new Error("桌面包后台图片提取失败");
  const extractedAssets = await page.locator(".asset-card").count();
  if (extractedAssets < 1) throw new Error("带图片的性能样本没有提取出图片");
  let imageScrollVerified = false;
  if (fixturePages >= 12) {
    const imageStep = page.locator(".image-step");
    const scrollMetrics = await imageStep.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    if (scrollMetrics.scrollHeight <= scrollMetrics.clientHeight) {
      throw new Error(`报告图片区没有形成可滚动区域：${JSON.stringify(scrollMetrics)}`);
    }
    await imageStep.hover();
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(150);
    const scrollTop = await imageStep.evaluate((element) => element.scrollTop);
    if (scrollTop < 100) throw new Error(`报告图片区无法通过滚轮向下滚动：scrollTop=${scrollTop}`);
    await imageStep.evaluate((element) => element.scrollTo({ top: 0 }));
    imageScrollVerified = true;
  }
  if (!await page.locator('.asset-card[aria-pressed="true"]').count()) await page.locator(".asset-card").first().click();
  await page.getByRole("button", { name: /下一步：最终审核/ }).click();
  await page.getByRole("heading", { name: "确认内容，再同步发布" }).waitFor();
  if (!await page.locator(".xhs-publish-card").isVisible()) throw new Error("桌面包最终审核页缺少小红书发布卡片");
  const bridgeReady = await page.evaluate(() => Boolean(window.reportAgentXhs?.preparePublish && window.reportAgentXhs?.submitScheduled));
  if (!bridgeReady) throw new Error("桌面包没有注入小红书安全发布桥接");
  await page.screenshot({ path: "/tmp/xhs-packaged-publish-review.png", fullPage: true });
  if (pageErrors.length) throw new Error(`桌面包出现页面错误：${pageErrors.join(" | ")}`);
  const assetsReadyMs = Math.round(performance.now() - startedAt);
  console.log(JSON.stringify({ runtime: await page.evaluate(() => navigator.userAgent), parsedPdf: true, fixturePages, textReadyMs, assetsReadyMs, extractedAssets, imageScrollVerified, backgroundVisibleAtTextReady, publishBridgeReady: bridgeReady, publishReviewScreenshot: "/tmp/xhs-packaged-publish-review.png", pageErrors }, null, 2));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  app.kill("SIGTERM");
  rmSync(temp, { recursive: true, force: true });
}
