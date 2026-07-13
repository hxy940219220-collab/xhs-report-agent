import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.APP_URL || "http://127.0.0.1:5180";
const executable = process.env.APP_EXECUTABLE;
const port = 9345;
const temp = executable ? mkdtempSync(join(tmpdir(), "xhs-workspace-test-")) : null;
const app = executable ? spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(temp, "profile")}`], { stdio: "ignore" }) : null;
const reportPath = process.env.HEALTH_REPORT;
if (!reportPath) throw new Error("请通过 HEALTH_REPORT 指定测试用 PDF 路径");
if (app) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* App is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
const browser = executable
  ? await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  : await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = executable ? browser.contexts()[0].pages()[0] : await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

if (!executable) await page.goto(baseUrl, { waitUntil: "networkidle" });
if (await page.getByText("企业 AI 应用趋势", { exact: true }).count()) throw new Error("侧栏仍显示不可删除的示例任务");
const defaultGroupColumns = await page.locator(".project-group-row").first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
if (defaultGroupColumns !== 2) throw new Error(`默认项目组仍保留无用操作列：${defaultGroupColumns} 列`);
await page.getByRole("button", { name: "新建项目组" }).click();
await page.getByPlaceholder("项目组名称").fill("健康消费项目");
await page.getByPlaceholder("项目组名称").press("Enter");
await page.getByText("健康消费项目", { exact: true }).waitFor();

await page.locator('input[type="file"]').setInputFiles(reportPath);
await page.locator('[aria-label="文案与封面"]').waitFor({ timeout: 60_000 });
const group = page.locator(".project-group").filter({ hasText: "健康消费项目" });
await group.getByText("炼丹炉_健康饮料市场消费趋势洞察", { exact: true }).waitFor({ timeout: 10_000 });
await group.locator(".group-toggle").dblclick();
await page.getByLabel("重命名项目组 健康消费项目").fill("健康消费项目-已改");
await page.getByLabel("重命名项目组 健康消费项目").press("Enter");
const renamedGroup = page.locator(".project-group").filter({ hasText: "健康消费项目-已改" });
await renamedGroup.waitFor();
await renamedGroup.locator(".group-toggle").dblclick();
await page.getByLabel("重命名项目组 健康消费项目-已改").fill("健康消费项目");
await page.getByLabel("重命名项目组 健康消费项目-已改").press("Enter");
const restoredNamedGroup = page.locator(".project-group").filter({ hasText: "健康消费项目" });
await restoredNamedGroup.locator(".history-task > button:first-child").dblclick();
await page.getByLabel(/重命名任务 炼丹炉_健康饮料市场消费趋势洞察/).fill("健康饮料趋势任务");
await page.getByLabel(/重命名任务 炼丹炉_健康饮料市场消费趋势洞察/).press("Enter");
await restoredNamedGroup.getByText("健康饮料趋势任务", { exact: true }).waitFor();
await restoredNamedGroup.locator(".history-task > button:first-child").dblclick();
await page.getByLabel("重命名任务 健康饮料趋势任务").fill("炼丹炉_健康饮料市场消费趋势洞察");
await page.getByLabel("重命名任务 健康饮料趋势任务").press("Enter");
await restoredNamedGroup.getByText("炼丹炉_健康饮料市场消费趋势洞察", { exact: true }).waitFor();

await page.getByRole("button", { name: "编辑", exact: true }).click();
const sourceInput = page.getByLabel("编辑报告来源");
if (await sourceInput.inputValue() !== "来源：炼丹炉") throw new Error(`封面来源识别错误：${await sourceInput.inputValue()}`);
const titleInput = page.getByLabel("编辑中文标题");
if (!/健康饮料市场消费趋势洞察/.test(await titleInput.inputValue())) throw new Error("封面中文标题没有使用报告原标题");
const cover = page.locator(".cover-stage img");
const originalCover = await cover.getAttribute("src");
await sourceInput.fill("来源：自定义报告来源");
await page.waitForFunction((previous) => document.querySelector(".cover-stage img")?.getAttribute("src") !== previous, originalCover);
const editedCover = await cover.getAttribute("src");
const titleLayer = page.locator(".cover-text-layer.title .cover-move-handle");
const box = await titleLayer.boundingBox();
if (!box) throw new Error("标题拖动层没有显示");
const titleTextLayer = page.locator(".cover-text-layer.title");
const originalTitleLeft = await titleTextLayer.evaluate((element) => element.style.left);
await titleLayer.press("ArrowRight");
await page.waitForFunction((previous) => document.querySelector(".cover-text-layer.title")?.style.left !== previous, originalTitleLeft);
await page.screenshot({ path: "/tmp/xhs-cover-direct-edit.png", fullPage: true });
const movedTitleLeft = await titleTextLayer.evaluate((element) => element.style.left);

await page.waitForTimeout(1100);
await page.reload({ waitUntil: "networkidle" });
const restoredGroup = page.locator(".project-group").filter({ hasText: "健康消费项目" });
await restoredGroup.locator(".group-toggle").click();
await restoredGroup.locator(".history-task > button:first-child").click();
await page.locator('[aria-label="文案与封面"]').waitFor();
await page.getByRole("button", { name: "编辑", exact: true }).click();
if (await page.getByLabel("编辑报告来源").inputValue() !== "来源：自定义报告来源") throw new Error("封面文字编辑没有随任务保存");
await page.evaluate(() => document.fonts?.ready);
await page.waitForTimeout(150);
if (await page.locator(".cover-text-layer.title").evaluate((element) => element.style.left) !== movedTitleLeft) throw new Error("封面文字位置没有随任务保存");
await page.getByRole("button", { name: "新建项目组" }).click();
await page.getByPlaceholder("项目组名称").fill("备用项目组");
await page.getByPlaceholder("项目组名称").press("Enter");
await page.waitForTimeout(1100);
await page.reload({ waitUntil: "networkidle" });
const healthGroupAfterBrowse = page.locator(".project-group").filter({ hasText: "健康消费项目" });
await healthGroupAfterBrowse.locator(".group-toggle").click();
if (!await healthGroupAfterBrowse.getByText("炼丹炉_健康饮料市场消费趋势洞察", { exact: true }).isVisible()) throw new Error("浏览或新建其他项目组时，当前任务被静默移动");
const spareGroup = page.locator(".project-group").filter({ hasText: "备用项目组" });
page.once("dialog", (dialog) => dialog.accept());
await spareGroup.getByRole("button", { name: "删除备用项目组" }).click();
await spareGroup.waitFor({ state: "detached" });
await healthGroupAfterBrowse.locator(".history-task > button:first-child").click();
const restoredGroupForDelete = page.locator(".project-group").filter({ hasText: "健康消费项目" });
page.once("dialog", (dialog) => dialog.accept());
await restoredGroupForDelete.getByRole("button", { name: /删除炼丹炉_健康饮料市场消费趋势洞察/ }).click();
await restoredGroupForDelete.getByText("炼丹炉_健康饮料市场消费趋势洞察", { exact: true }).waitFor({ state: "detached" });
page.once("dialog", (dialog) => dialog.accept());
await page.getByRole("button", { name: "删除健康消费项目" }).click();
await page.getByText("健康消费项目", { exact: true }).waitFor({ state: "detached" });
if (errors.length) throw new Error(errors.join(" | "));

console.log(JSON.stringify({ groupCreated: true, groupRenamedInline: true, taskNested: true, taskRenamedInline: true, sampleRemoved: true, sourceDetected: "炼丹炉", coverTextEdited: true, titleDragged: true, coverPersisted: true, crossGroupBrowseSafe: true, taskDeleted: true, groupDeleted: true }, null, 2));
await browser.close();
if (app) app.kill("SIGTERM");
if (temp) rmSync(temp, { recursive: true, force: true });
