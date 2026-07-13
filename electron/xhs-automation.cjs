const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CREATOR_HOME_URL = "https://creator.xiaohongshu.com";
const CREATOR_PUBLISH_URL =
  "https://creator.xiaohongshu.com/publish/publish?source=official";
const CREATOR_PARTITION = "persist:xhs-report-agent";
const FINAL_CONFIRMATION = "CONFIRM_SCHEDULE_PUBLISH";
const MIN_SCHEDULE_DELAY_MS = 60 * 60 * 1000;
const MAX_SCHEDULE_DELAY_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 180 * 1024 * 1024;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function visibleElementScript(selector) {
  return `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  })`;
}

function parseDataUrl(dataUrl, index) {
  if (typeof dataUrl !== "string") {
    throw new Error(`第 ${index + 1} 张图片不是有效的本地图片`);
  }
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new Error(`第 ${index + 1} 张图片格式不支持，请使用 PNG、JPG 或 WebP`);
  }
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`第 ${index + 1} 张图片为空或超过 32 MB`);
  }
  const mime = match[1].toLowerCase();
  const extension = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const signatureMatches = extension === "png"
    ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : extension === "webp"
      ? buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
      : buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!signatureMatches) throw new Error(`第 ${index + 1} 张图片内容与声明格式不一致`);
  return { buffer, extension };
}

function validatePublishRequest(request) {
  if (!request || typeof request !== "object") throw new Error("发布参数为空");
  const title = String(request.title || "").trim();
  const content = String(request.content || "").trim();
  const tags = Array.isArray(request.tags)
    ? [...new Set(request.tags.map((tag) => String(tag || "").replace(/^#+/, "").trim()).filter(Boolean))]
    : [];
  const images = Array.isArray(request.images) ? request.images : [];
  const scheduleAt = new Date(request.scheduleAt);

  if (!title || Array.from(title).length > 20) {
    throw new Error("小红书标题必须为 1–20 个字");
  }
  if (!content || Array.from(content).length > 1000) {
    throw new Error("正文不能为空且不能超过 1000 字");
  }
  if (tags.length !== 10) throw new Error("同步前必须确认正好 10 个标签");
  if (tags.some((tag) => Array.from(tag).length > 20 || /[\s#]/.test(tag))) {
    throw new Error("话题标签不能包含空格或 #，且每个标签不能超过 20 个字");
  }
  const composedLength = Array.from(`${content}\n\n${tags.map((tag) => `#${tag}`).join(" ")}`).length;
  if (composedLength > 1000) throw new Error("正文与 10 个标签合计不能超过 1000 字");
  if (images.length < 1 || images.length > 18) {
    throw new Error("图文笔记需要 1–18 张图片");
  }
  if (Number.isNaN(scheduleAt.getTime())) throw new Error("定时发布时间无效");
  const delay = scheduleAt.getTime() - Date.now();
  if (delay < MIN_SCHEDULE_DELAY_MS || delay > MAX_SCHEDULE_DELAY_MS) {
    throw new Error("定时发布时间必须在 1 小时至 14 天内");
  }
  if (request.groupStrategy !== "smallest") {
    throw new Error("当前版本只支持自动选择人数最少的群聊");
  }

  return {
    projectId: String(request.projectId || "local-project").slice(0, 80),
    title,
    content,
    tags,
    images,
    scheduleAt,
    groupStrategy: "smallest",
  };
}

function formatScheduleTime(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

function isConfirmedPublishResult({ beforeUrl, afterUrl, beforeBodyText, bodyText }) {
  const successPattern = /(?:定时发布成功|发布成功(?:啦|！|!|$)|已成功加入定时发布)/;
  const explicitSuccess = successPattern.test(String(bodyText || ""))
    && !successPattern.test(String(beforeBodyText || ""));
  return Boolean(beforeUrl && afterUrl) && explicitSuccess;
}

function comparePreparedSnapshot(actual, expected) {
  const problems = [];
  const normalize = (value) => String(value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, "");
  if (actual.title !== expected.title) problems.push("标题未正确写入");
  const actualTags = (String(actual.content || "").match(/#[^\s#]+/g) || []).map((tag) => tag.slice(1));
  const actualBaseContent = String(actual.content || "").replace(/#[^\s#]+/g, "");
  if (normalize(actualBaseContent) !== normalize(expected.content)) problems.push("正文与本地终审版本不完全一致");
  if (actual.imageCount !== expected.imageCount) problems.push(`图片数量为 ${actual.imageCount}，预期 ${expected.imageCount} 张`);
  if (actualTags.length !== expected.tags.length || expected.tags.some((tag) => !actualTags.includes(tag))) {
    problems.push(`话题标签未精确写入 10 个（当前识别 ${actualTags.length} 个）`);
  }
  if (!String(actual.schedule || "").includes(expected.schedule.slice(0, 16))) problems.push("定时时间未正确设置");
  if (!actual.hasScheduledButton) problems.push("页面没有进入定时发布状态");
  if (actual.hasGroupPlaceholder) problems.push("群聊没有选择成功");
  if (!String(actual.selectedGroupText || "").includes(expected.group.name)) problems.push("无法从群聊选择控件确认目标群聊");
  const selectedCount = String(actual.selectedGroupText || "").match(/(\d[\d,]*)\s*人/);
  if (selectedCount && Number(selectedCount[1].replace(/,/g, "")) !== expected.group.count) problems.push("已选群聊人数与目标不一致");
  if (!expected.group.countDisambiguated) problems.push("目标群聊人数未完成唯一性校验");
  return { ok: problems.length === 0, problems, actual };
}

function registerXhsAutomation({ app, BrowserWindow, dialog, ipcMain, session, assertTrustedSender }) {
  let creatorWindow = null;
  let activeAttempt = null;
  let activeSender = null;
  let loginWatchVersion = 0;
  let operationInFlight = false;
  let creatorSessionConfigured = false;

  const runtimeRoot = () => path.join(app.getPath("userData"), "xhs-publish-payloads");
  const receiptPath = () => path.join(app.getPath("userData"), "xhs-pending-submit.json");
  const creatorSession = () => session.fromPartition(CREATOR_PARTITION, { cache: true });

  function readPendingReceipt() {
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath(), "utf8"));
      return ["pending_confirmation", "confirmed_published"].includes(receipt?.status) ? receipt : null;
    } catch {
      return null;
    }
  }

  function writePendingReceipt(receipt) {
    const target = receiptPath();
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, target);
  }

  function clearPendingReceipt() {
    fs.rmSync(receiptPath(), { force: true });
    fs.rmSync(`${receiptPath()}.tmp`, { force: true });
  }

  function requestFingerprint(request) {
    const hash = crypto.createHash("sha256");
    hash.update(request.projectId);
    hash.update("\0");
    hash.update(request.title);
    hash.update("\0");
    hash.update(request.content);
    hash.update("\0");
    hash.update(request.tags.join("\0"));
    hash.update("\0");
    hash.update(request.scheduleAt.toISOString());
    for (const image of request.images) {
      hash.update("\0");
      hash.update(image);
    }
    return hash.digest("hex");
  }

  function emit(stage, message, extra = {}) {
    if (activeSender && !activeSender.isDestroyed()) {
      activeSender.send("xhs:publish-progress", { stage, message, ...extra });
    }
  }

  async function removeAttemptFiles(attempt) {
    if (!attempt?.payloadDir) return;
    await fs.promises.rm(attempt.payloadDir, { recursive: true, force: true }).catch(() => undefined);
  }

  async function cleanOldPayloads() {
    const root = runtimeRoot();
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
    const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) return;
      const fullPath = path.join(root, entry.name);
      const stats = await fs.promises.stat(fullPath).catch(() => null);
      if (stats && stats.mtimeMs < cutoff) {
        await fs.promises.rm(fullPath, { recursive: true, force: true }).catch(() => undefined);
      }
    }));
  }

  async function materializeImages(images, attemptId) {
    await cleanOldPayloads();
    const payloadDir = path.join(runtimeRoot(), attemptId);
    await fs.promises.mkdir(payloadDir, { recursive: true, mode: 0o700 });
    try {
      let totalBytes = 0;
      const paths = [];
      for (let index = 0; index < images.length; index += 1) {
        const parsed = parseDataUrl(images[index], index);
        totalBytes += parsed.buffer.length;
        if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error("发布图片总大小超过 180 MB");
        const filePath = path.join(
          payloadDir,
          `${String(index + 1).padStart(2, "0")}-${index === 0 ? "cover" : "report"}.${parsed.extension}`,
        );
        await fs.promises.writeFile(filePath, parsed.buffer, { mode: 0o600 });
        paths.push(filePath);
      }
      return { payloadDir, paths };
    } catch (error) {
      await fs.promises.rm(payloadDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  function isAllowedCreatorUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return url.protocol === "https:" && url.hostname === "creator.xiaohongshu.com";
    } catch {
      return false;
    }
  }

  function ensureCreatorWindow() {
    if (creatorWindow && !creatorWindow.isDestroyed()) {
      creatorWindow.show();
      creatorWindow.focus();
      return creatorWindow;
    }
    const ses = creatorSession();
    if (!creatorSessionConfigured) {
      ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      ses.setPermissionCheckHandler(() => false);
      ses.on("will-download", (event) => event.preventDefault());
      creatorSessionConfigured = true;
    }
    creatorWindow = new BrowserWindow({
      width: 1420,
      height: 940,
      minWidth: 1080,
      minHeight: 720,
      show: true,
      title: "小红书发布确认 · 研报笔记 Agent",
      backgroundColor: "#ffffff",
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    creatorWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    creatorWindow.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedCreatorUrl(url)) event.preventDefault();
    });
    creatorWindow.webContents.on("will-redirect", (event, url) => {
      if (!isAllowedCreatorUrl(url)) event.preventDefault();
    });
    creatorWindow.on("closed", () => {
      loginWatchVersion += 1;
      creatorWindow = null;
      if (activeAttempt && ["preparing", "prepared", "submitting"].includes(activeAttempt.status)) {
        const wasSubmitting = activeAttempt.status === "submitting";
        activeAttempt.cancelled = true;
        activeAttempt.status = wasSubmitting ? "submitted_unknown" : "window_closed";
        emit(
          wasSubmitting ? "submitted_unknown" : "window_closed",
          wasSubmitting
            ? "提交过程中窗口被关闭，结果状态不明确；系统不会自动重试"
            : "小红书编辑窗口已关闭，未执行发布",
        );
      }
    });
    return creatorWindow;
  }

  async function evaluate(expression) {
    if (activeAttempt?.cancelled) throw new Error("小红书编辑窗口已关闭");
    if (!creatorWindow || creatorWindow.isDestroyed()) throw new Error("小红书编辑窗口不可用");
    const window = creatorWindow;
    return window.webContents.executeJavaScript(expression, true);
  }

  async function readPageState() {
    if (!creatorWindow || creatorWindow.isDestroyed()) {
      return { connected: false, accountName: "", url: "" };
    }
    return evaluate(`(() => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const blocked = new Set(["小红书", "创作服务平台", "发布笔记", "首页", "笔记管理", "数据看板"]);
      const candidates = Array.from(document.querySelectorAll("header *, [class*=header] *, [class*=user] *"))
        .filter(visible)
        .map((element) => ({ text: (element.innerText || element.textContent || "").trim(), rect: element.getBoundingClientRect() }))
        .filter((item) => item.text.length >= 2 && item.text.length <= 18 && item.rect.top < 150 && item.rect.left > innerWidth * 0.55 && !blocked.has(item.text));
      const accountName = candidates.sort((a, b) => b.rect.left - a.rect.left)[0]?.text || "";
      const bodyText = document.body?.innerText || "";
      const loginVisible = /扫码登录|手机号登录|登录后开始创作/.test(bodyText);
      const creatorShellVisible = /发布笔记|笔记管理|数据看板|账号状态正常/.test(bodyText);
      return {
        connected: location.hostname === "creator.xiaohongshu.com" && creatorShellVisible && !loginVisible,
        accountName,
        url: location.href,
      };
    })()`);
  }

  async function waitFor(check, timeoutMs, errorMessage, intervalMs = 350) {
    const started = Date.now();
    let lastError = null;
    while (Date.now() - started < timeoutMs) {
      if (activeAttempt?.cancelled) throw new Error("小红书编辑窗口已关闭");
      try {
        const value = await check();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(intervalMs);
    }
    throw new Error(lastError?.message || errorMessage);
  }

  async function waitForLogin() {
    const state = await readPageState();
    if (state.connected) return state;
    emit("awaiting_login", "请在小红书官方窗口扫码登录，登录后会自动继续");
    return waitFor(
      async () => {
        const next = await readPageState();
        return next.connected ? next : null;
      },
      5 * 60 * 1000,
      "等待小红书扫码登录超时，请重新同步",
      800,
    );
  }

  function watchForLogin() {
    const version = ++loginWatchVersion;
    void (async () => {
      const started = Date.now();
      while (version === loginWatchVersion && Date.now() - started < 5 * 60 * 1000) {
        if (!creatorWindow || creatorWindow.isDestroyed()) return;
        const state = await readPageState().catch(() => null);
        if (state?.connected) {
          emit("connected", state.accountName ? `已连接 @${state.accountName}` : "小红书账号已连接", {
            accountName: state.accountName,
          });
          return;
        }
        await sleep(800);
      }
    })();
  }

  async function clickImageTextTab() {
    const clicked = await evaluate(`(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== "none";
      };
      const tabs = Array.from(document.querySelectorAll("div.creator-tab, [role=tab]"));
      const tab = tabs.find((element) => visible(element) && element.textContent.trim() === "上传图文");
      if (!tab) return false;
      tab.click();
      return true;
    })()`);
    if (!clicked) throw new Error("没有找到“上传图文”入口，小红书页面结构可能已变化");
  }

  async function uploadImages(imagePaths) {
    const webContents = ensureCreatorWindow().webContents;
    const attachedHere = !webContents.debugger.isAttached();
    if (attachedHere) webContents.debugger.attach("1.3");
    try {
      await webContents.debugger.sendCommand("DOM.enable");
      const documentResult = await webContents.debugger.sendCommand("DOM.getDocument");
      const rootNodeId = documentResult.root.nodeId;
      let nodeId = 0;
      for (const selector of ["input.upload-input", "input[type=file]"]) {
        const result = await webContents.debugger.sendCommand("DOM.querySelector", {
          nodeId: rootNodeId,
          selector,
        });
        if (result.nodeId) {
          nodeId = result.nodeId;
          break;
        }
      }
      if (!nodeId) throw new Error("没有找到图片上传控件，小红书页面结构可能已变化");
      await webContents.debugger.sendCommand("DOM.setFileInputFiles", {
        nodeId,
        files: imagePaths,
      });
      await waitFor(
        async () => {
          const state = await evaluate(`(() => {
          const primary = document.querySelectorAll(".img-preview-area .pr").length;
          const fallback = document.querySelectorAll(".img-preview-area [class*=preview-item]").length;
          const area = document.querySelector(".img-preview-area") || document.body;
          const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          };
          const pending = Array.from(area.querySelectorAll("[class*=uploading], [class*=loading], [class*=progress]"))
            .some(visible);
          const text = area.innerText || "";
          return { count: Math.max(primary, fallback), pending, error: /上传失败|重新上传/.test(text) };
        })()`);
          if (state.error) throw new Error("小红书页面提示图片上传失败");
          return state.count === imagePaths.length && !state.pending;
        },
        90_000,
        `图片上传超时，未确认 ${imagePaths.length} 张图片全部完成`,
        700,
      );
    } finally {
      if (attachedHere && webContents.debugger.isAttached()) webContents.debugger.detach();
    }
  }

  async function focusAndReplace(selector, text, kind) {
    const webContents = ensureCreatorWindow().webContents;
    const focused = await evaluate(`(() => {
      const element = ${visibleElementScript(selector)};
      if (!element) return false;
      element.focus();
      return true;
    })()`);
    if (!focused) throw new Error(`没有找到${kind}输入框`);
    webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["meta"] });
    webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["meta"] });
    webContents.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
    webContents.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
    webContents.insertText(text);
    await sleep(350);
  }

  async function fillTitleAndContent(title, content) {
    await focusAndReplace('input[placeholder*="填写标题"], div.d-input input, input.d-text', title, "标题");
    await focusAndReplace('div.tiptap.ProseMirror[contenteditable="true"], div.ProseMirror[contenteditable="true"], div.ql-editor[contenteditable="true"], [role=textbox][contenteditable="true"]', content, "正文");
  }

  async function addTags(tags) {
    const webContents = ensureCreatorWindow().webContents;
    for (const tag of tags) {
      const focused = await evaluate(`(() => {
        const element = ${visibleElementScript('div.tiptap.ProseMirror[contenteditable="true"], div.ProseMirror[contenteditable="true"], div.ql-editor[contenteditable="true"], [role=textbox][contenteditable="true"]')};
        if (!element) return false;
        element.focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      })()`);
      if (!focused) throw new Error("添加标签时没有找到正文编辑器");
      if (tag === tags[0]) webContents.insertText("\n\n");
      webContents.insertText(`#${tag}`);
      await sleep(900);
      const selected = await evaluate(`(() => {
        const container = document.querySelector("#creator-editor-topic-container");
        const expected = ${JSON.stringify(tag)};
        const item = container && Array.from(container.querySelectorAll(".item, [role=option]")).find((element) => {
          const rect = element.getBoundingClientRect();
          const firstLine = (element.innerText || element.textContent || "").trim().split(/\\n+/)[0]?.replace(/^#/, "").trim();
          const topicName = firstLine?.split(/\\s+/)[0] || "";
          return rect.width > 0 && rect.height > 0 && topicName === expected;
        });
        if (!item) return false;
        item.click();
        return true;
      })()`);
      if (!selected) throw new Error(`没有识别到话题 #${tag}，已停止同步`);
      webContents.insertText(" ");
      await sleep(250);
    }
  }

  async function selectSmallestGroup() {
    const opened = await evaluate(`(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== "none";
      };
      const elements = Array.from(document.querySelectorAll("div, button, span"));
      const label = elements.find((element) => visible(element) && element.textContent.trim() === "选择群聊");
      if (!label) return false;
      const clickable = label.closest("button, [role=button], .d-select, .d-select-content") || label.parentElement;
      if (!clickable) return null;
      const rect = clickable.getBoundingClientRect();
      clickable.click();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    })()`);
    if (!opened) throw new Error("没有找到“选择群聊”控件");
    await sleep(700);
    const selected = await evaluate(`(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const anchor = ${JSON.stringify(opened)};
      const optionSelector = "li, [role=option], [class*=option], [class*=item], div";
      const options = Array.from(document.querySelectorAll(optionSelector))
        .filter(visible)
        .map((element) => {
          const text = (element.innerText || "").trim();
          const matches = text.match(/(\\d[\\d,]*)\\s*人/g) || [];
          const countMatch = text.match(/(\\d[\\d,]*)\\s*人/);
          const rect = element.getBoundingClientRect();
          const lines = text.split(/\\n+/).map((line) => line.trim()).filter(Boolean);
          const hasName = lines.some((line) => !/(\\d[\\d,]*)\\s*人/.test(line) && !/^(?:可分享的群聊|选择群聊)$/.test(line));
          const hasNestedCompleteOption = Array.from(element.querySelectorAll(optionSelector)).some((child) => {
            if (child === element) return false;
            const childLines = (child.innerText || "").trim().split(/\\n+/).map((line) => line.trim()).filter(Boolean);
            return childLines.some((line) => /(\\d[\\d,]*)\\s*人/.test(line))
              && childLines.some((line) => !/(\\d[\\d,]*)\\s*人/.test(line) && !/^(?:可分享的群聊|选择群聊)$/.test(line));
          });
          const name = lines.find((line) => !/(\\d[\\d,]*)\\s*人/.test(line) && !/^(?:可分享的群聊|选择群聊)$/.test(line)) || "";
          return { element, text, matches, rect, name, hasName, hasNestedCompleteOption, count: countMatch ? Number(countMatch[1].replace(/,/g, "")) : NaN };
        })
        .filter((item) =>
          item.matches.length === 1
          && Number.isFinite(item.count)
          && item.text.length <= 120
          && item.hasName
          && !item.hasNestedCompleteOption
          && item.rect.height <= 180
          && item.rect.top >= anchor.top - 24
          && item.rect.left < anchor.right + 420
          && item.rect.right > anchor.left - 420
        );
      if (!options.length) return null;
      options.sort((a, b) => a.count - b.count || a.text.length - b.text.length);
      const choice = options[0];
      const sameNameCounts = new Set(options.filter((item) => item.name === choice.name).map((item) => item.count));
      if (sameNameCounts.size > 1) return { ambiguous: true, name: choice.name };
      const clickable = choice.element.closest("li, [role=option], button, [role=button]") || choice.element;
      clickable.click();
      return { name: choice.name || "人数最少群聊", count: choice.count, optionText: choice.text, anchor, countDisambiguated: true };
    })()`);
    if (!selected) throw new Error("没有找到可选择的群聊，未继续发布");
    if (selected.ambiguous) throw new Error(`存在同名但人数不同的群聊“${selected.name}”，无法安全自动选择`);
    await sleep(500);
    return selected;
  }

  async function setSchedule(scheduleAt) {
    const scheduleText = formatScheduleTime(scheduleAt);
    const toggled = await evaluate(`(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== "none";
      };
      const direct = ${visibleElementScript(".post-time-wrapper .d-switch")};
      let switchElement = direct;
      if (!switchElement) {
        const labels = Array.from(document.querySelectorAll("div, span")).filter((element) => visible(element) && element.textContent.trim() === "定时发布");
        const card = labels[0]?.closest(".post-time-wrapper, .custom-switch-card, [class*=time]") || labels[0]?.parentElement;
        switchElement = card?.querySelector(".d-switch, input[type=checkbox]");
      }
      if (!switchElement) return false;
      const checkbox = switchElement.matches("input") ? switchElement : switchElement.querySelector("input[type=checkbox]");
      const enabled = checkbox?.checked || switchElement.classList.contains("active") || switchElement.getAttribute("aria-checked") === "true";
      if (!enabled) switchElement.click();
      return true;
    })()`);
    if (!toggled) throw new Error("没有找到定时发布开关");
    await sleep(700);
    const inputReady = await waitFor(
      () => evaluate(`Boolean(${visibleElementScript('.date-picker-container input, .post-time-wrapper input[type=text], input[placeholder*="时间"]')})`),
      8_000,
      "打开定时发布后没有出现时间输入框",
    );
    if (!inputReady) throw new Error("定时时间输入框不可用");
    await focusAndReplace('.date-picker-container input, .post-time-wrapper input[type=text], input[placeholder*="时间"]', scheduleText, "定时时间");
    await evaluate(`(() => {
      const input = ${visibleElementScript('.date-picker-container input, .post-time-wrapper input[type=text], input[placeholder*="时间"]')};
      if (!input) return false;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      return true;
    })()`);
    await sleep(500);
    return scheduleText;
  }

  async function verifyPrepared(expected) {
    return evaluate(`(() => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const title = (${visibleElementScript('input[placeholder*="填写标题"], div.d-input input, input.d-text')})?.value || "";
      const editor = ${visibleElementScript('div.tiptap.ProseMirror[contenteditable="true"], div.ProseMirror[contenteditable="true"], div.ql-editor[contenteditable="true"], [role=textbox][contenteditable="true"]')};
      const imageCount = Math.max(
        document.querySelectorAll(".img-preview-area .pr").length,
        document.querySelectorAll(".img-preview-area [class*=preview-item]").length
      );
      const scheduleInput = ${visibleElementScript('.date-picker-container input, .post-time-wrapper input[type=text], input[placeholder*="时间"]')};
      const buttons = Array.from(document.querySelectorAll("button, [role=button]")).filter(visible);
      const scheduledButton = buttons.find((button) => button.textContent.trim() === "定时发布");
      const groupPlaceholder = Array.from(document.querySelectorAll("div, span")).find((element) => visible(element) && element.textContent.trim() === "选择群聊");
      const groupAnchor = ${JSON.stringify(expected.group.anchor || null)};
      const selectedGroupText = Array.from(document.querySelectorAll("button, [role=button], .d-select, .d-select-content, [class*=select], div"))
        .filter(visible)
        .map((element) => ({ element, text: (element.innerText || "").trim(), rect: element.getBoundingClientRect() }))
        .filter((item) => {
          if (!groupAnchor || !item.text.includes(${JSON.stringify(expected.group.name)})) return false;
          const nearAnchor = item.rect.left < groupAnchor.right + 40
            && item.rect.right > groupAnchor.left - 40
            && item.rect.top < groupAnchor.bottom + 40
            && item.rect.bottom > groupAnchor.top - 40;
          return nearAnchor && item.rect.height <= 160 && item.rect.width <= 900;
        })
        .sort((a, b) => a.text.length - b.text.length)[0]?.text || "";
      return {
        title,
        content: (editor?.innerText || editor?.textContent || "").trim(),
        imageCount,
        schedule: scheduleInput?.value || "",
        hasScheduledButton: Boolean(scheduledButton),
        hasGroupPlaceholder: Boolean(groupPlaceholder),
        selectedGroupText,
      };
    })()`).then((actual) => comparePreparedSnapshot(actual, expected));
  }

  async function clickScheduledPublish(onBeforeDispatch) {
    const coordinates = await evaluate(`(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !element.disabled && getComputedStyle(element).display !== "none";
      };
      const candidates = Array.from(document.querySelectorAll("button, xhs-publish-btn"))
        .filter(visible)
        .filter((element) => element.textContent.trim() === "定时发布")
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter((item) => item.rect.top > innerHeight * 0.45)
        .sort((a, b) => b.rect.top - a.rect.top || (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
      const button = candidates[0]?.element;
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    if (!coordinates) throw new Error("没有找到可点击的“定时发布”按钮，已停止操作");
    onBeforeDispatch?.();
    const webContents = ensureCreatorWindow().webContents;
    webContents.sendInputEvent({ type: "mouseMove", x: coordinates.x, y: coordinates.y });
    webContents.sendInputEvent({ type: "mouseDown", x: coordinates.x, y: coordinates.y, button: "left", clickCount: 1 });
    webContents.sendInputEvent({ type: "mouseUp", x: coordinates.x, y: coordinates.y, button: "left", clickCount: 1 });
  }

  ipcMain.handle("xhs:get-status", async (event) => {
    assertTrustedSender(event);
    if (creatorWindow && !creatorWindow.isDestroyed()) {
      return { ...(await readPageState()), pendingReceipt: readPendingReceipt() };
    }
    const cookies = await creatorSession().cookies.get({ url: CREATOR_HOME_URL });
    return { connected: false, hasSavedSession: cookies.length > 0, accountName: "", url: "", pendingReceipt: readPendingReceipt() };
  });

  ipcMain.handle("xhs:open-login", async (event) => {
    assertTrustedSender(event);
    if (operationInFlight) throw new Error("小红书同步操作正在进行，请稍后再试");
    if (readPendingReceipt() && activeAttempt?.cancelled) activeAttempt = null;
    activeSender = event.sender;
    const window = ensureCreatorWindow();
    await window.loadURL(CREATOR_HOME_URL);
    const state = await readPageState();
    emit(state.connected ? "connected" : "awaiting_login", state.connected ? "小红书账号已连接" : "请在官方页面扫码登录");
    if (!state.connected) watchForLogin();
    return { ...state, pendingReceipt: readPendingReceipt() };
  });

  ipcMain.handle("xhs:prepare-publish", async (event, rawRequest) => {
    assertTrustedSender(event);
    if (operationInFlight || (activeAttempt && ["preparing", "submitting"].includes(activeAttempt.status))) {
      throw new Error("已有小红书同步任务正在进行中");
    }
    if (readPendingReceipt()) {
      throw new Error("上一次定时发布结果仍待人工确认，请先在小红书官方页面核对后解除锁定");
    }
    activeSender = event.sender;
    const request = validatePublishRequest(rawRequest);
    const attemptId = crypto.randomUUID();
    const previousAttempt = activeAttempt;
    const attempt = { id: attemptId, status: "preparing", request, fingerprint: requestFingerprint(request), payloadDir: "", imagePaths: [] };
    activeAttempt = attempt;
    operationInFlight = true;
    try {
      await removeAttemptFiles(previousAttempt);
      emit("preparing", "正在整理本地发布素材", { attemptId });
      const payload = await materializeImages(request.images, attemptId);
      activeAttempt.payloadDir = payload.payloadDir;
      activeAttempt.imagePaths = payload.paths;

      const window = ensureCreatorWindow();
      await window.loadURL(CREATOR_HOME_URL);
      const account = await waitForLogin();
      if (!account.accountName) throw new Error("无法识别当前小红书账号昵称，已停止同步以避免发错账号");
      attempt.accountName = account.accountName;
      emit("connected", account.accountName ? `已连接 @${account.accountName}` : "小红书账号已连接", { accountName: account.accountName });

      emit("opening_editor", "正在打开图文编辑页");
      await window.loadURL(CREATOR_PUBLISH_URL);
      await waitFor(() => evaluate("Boolean(document.querySelector('div.upload-content'))"), 20_000, "图文编辑页加载超时");
      await clickImageTextTab();
      await waitFor(() => evaluate("Boolean(document.querySelector('input[type=file]'))"), 12_000, "图片上传区域加载超时");

      emit("uploading", `正在上传 ${payload.paths.length} 张图片`, { current: 0, total: payload.paths.length });
      await uploadImages(payload.paths);
      await removeAttemptFiles(activeAttempt);
      emit("uploading", `${payload.paths.length} 张图片上传完成`, { current: payload.paths.length, total: payload.paths.length });

      emit("filling", "正在填写标题和正文");
      await fillTitleAndContent(request.title, request.content);
      emit("tags", "正在添加 10 个话题标签");
      await addTags(request.tags);

      emit("group", "正在选择人数最少的群聊");
      const group = await selectSmallestGroup();
      emit("group", `已选择 ${group.name}（${group.count} 人）`, { group });

      emit("schedule", "正在设置定时发布时间");
      const schedule = await setSchedule(request.scheduleAt);
      const verification = await verifyPrepared({
        title: request.title,
        content: request.content,
        tags: request.tags,
        imageCount: payload.paths.length,
        schedule,
        group,
      });
      if (!verification.ok) throw new Error(`同步校验未通过：${verification.problems.join("；")}`);

      activeAttempt.status = "prepared";
      activeAttempt.group = group;
      activeAttempt.schedule = schedule;
      activeAttempt.verification = verification;
      emit("prepared", "内容已填写并校验，等待你确认定时发布", {
        attemptId,
        group,
        schedule,
        accountName: account.accountName,
      });
      window.show();
      window.focus();
      return {
        status: "prepared",
        attemptId,
        group: { name: group.name, count: group.count },
        schedule,
        accountName: account.accountName,
        imageCount: payload.paths.length,
      };
    } catch (error) {
      if (activeAttempt?.id === attemptId) activeAttempt.status = "failed";
      await removeAttemptFiles(activeAttempt);
      emit("failed", error?.message || "同步失败，未执行发布", { attemptId });
      throw error;
    } finally {
      operationInFlight = false;
    }
  });

  ipcMain.handle("xhs:submit-scheduled", async (event, request) => {
    assertTrustedSender(event);
    if (request?.confirmation !== FINAL_CONFIRMATION) throw new Error("缺少最终发布确认");
    if (operationInFlight) throw new Error("已有小红书操作正在进行中");
    if (!activeAttempt || activeAttempt.id !== request.attemptId || activeAttempt.status !== "prepared") {
      throw new Error("没有可提交的已校验发布任务，请先同步到编辑页");
    }
    activeSender = event.sender;
    activeAttempt.status = "submitting";
    operationInFlight = true;
    let clicked = false;
    try {
      emit("submitting", "正在进行最终页面复核");
      const remainingDelay = activeAttempt.request.scheduleAt.getTime() - Date.now();
      if (remainingDelay < MIN_SCHEDULE_DELAY_MS || remainingDelay > MAX_SCHEDULE_DELAY_MS) {
        throw new Error("定时发布时间已不在 1 小时至 14 天范围内，请重新同步");
      }
      const finalAccount = await readPageState();
      if (!finalAccount.connected || !finalAccount.accountName || finalAccount.accountName !== activeAttempt.accountName) {
        throw new Error(`发布账号已变化或无法确认（预期 @${activeAttempt.accountName}），已拒绝发布`);
      }
      const verification = await verifyPrepared({
        title: activeAttempt.request.title,
        content: activeAttempt.request.content,
        tags: activeAttempt.request.tags,
        imageCount: activeAttempt.imagePaths.length,
        schedule: activeAttempt.schedule,
        group: activeAttempt.group,
      });
      if (!verification.ok) {
        throw new Error(`页面内容发生变化，已拒绝发布：${verification.problems.join("；")}`);
      }
      const nativeConfirmation = await dialog.showMessageBox(creatorWindow, {
        type: "warning",
        buttons: ["取消", "确认定时发布"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: "最终发布确认",
        message: `确认发布到 @${activeAttempt.accountName}？`,
        detail: `群聊：${activeAttempt.group.name}（${activeAttempt.group.count} 人）\n图片：${activeAttempt.imagePaths.length} 张\n时间：${activeAttempt.schedule}（北京时间）\n\n点击确认后将操作小红书官方页面，状态不明确时不会自动重试。`,
      });
      if (nativeConfirmation.response !== 1) throw new Error("已取消定时发布");
      const finalRemainingDelay = activeAttempt.request.scheduleAt.getTime() - Date.now();
      if (finalRemainingDelay < MIN_SCHEDULE_DELAY_MS || finalRemainingDelay > MAX_SCHEDULE_DELAY_MS) {
        throw new Error("确认期间定时时间已不满足 1 小时至 14 天要求，请重新同步");
      }
      const accountAfterConfirmation = await readPageState();
      if (!accountAfterConfirmation.connected || accountAfterConfirmation.accountName !== activeAttempt.accountName) {
        throw new Error(`确认期间发布账号发生变化（预期 @${activeAttempt.accountName}），已拒绝发布`);
      }
      const verificationAfterConfirmation = await verifyPrepared({
        title: activeAttempt.request.title,
        content: activeAttempt.request.content,
        tags: activeAttempt.request.tags,
        imageCount: activeAttempt.imagePaths.length,
        schedule: activeAttempt.schedule,
        group: activeAttempt.group,
      });
      if (!verificationAfterConfirmation.ok) {
        throw new Error(`确认期间页面内容发生变化，已拒绝发布：${verificationAfterConfirmation.problems.join("；")}`);
      }
      const beforeUrl = ensureCreatorWindow().webContents.getURL();
      const beforeBodyText = await evaluate("document.body.innerText.slice(-4000)").catch(() => "");
      writePendingReceipt({
        id: activeAttempt.id,
        projectId: activeAttempt.request.projectId,
        fingerprint: activeAttempt.fingerprint,
        title: activeAttempt.request.title,
        accountName: activeAttempt.accountName,
        group: { name: activeAttempt.group.name, count: activeAttempt.group.count },
        schedule: activeAttempt.schedule,
        imageCount: activeAttempt.imagePaths.length,
        clickedAt: Date.now(),
        status: "pending_confirmation",
      });
      await clickScheduledPublish(() => {
        clicked = true;
        activeAttempt.status = "submitted_unknown";
      });
      emit("submitted_unknown", "已点击定时发布，正在等待小红书明确返回；系统不会自动重试");
      let confirmed = false;
      const confirmationStarted = Date.now();
      while (Date.now() - confirmationStarted < 12_000 && !activeAttempt.cancelled) {
        await sleep(500);
        const bodyText = await evaluate("document.body.innerText.slice(-4000)").catch(() => "");
        const afterUrl = creatorWindow && !creatorWindow.isDestroyed() ? creatorWindow.webContents.getURL() : "";
        confirmed = isConfirmedPublishResult({ beforeUrl, afterUrl, beforeBodyText, bodyText });
        if (confirmed) break;
      }
      activeAttempt.status = confirmed ? "submitted" : "submitted_unknown";
      if (confirmed) {
        const receipt = readPendingReceipt();
        if (receipt) writePendingReceipt({ ...receipt, status: "confirmed_published" });
      }
      emit(
        confirmed ? "submitted" : "submitted_unknown",
        confirmed
          ? "小红书已确认定时发布成功"
          : "小红书未返回明确成功状态，请在官方页面确认；系统不会自动重试",
      );
      await removeAttemptFiles(activeAttempt);
      return { status: activeAttempt.status, confirmed };
    } catch (error) {
      if (clicked) {
        activeAttempt.status = "submitted_unknown";
        emit("submitted_unknown", "提交后无法确认结果，请在小红书官方页面检查；系统不会自动重试");
        await removeAttemptFiles(activeAttempt);
        return { status: "submitted_unknown", confirmed: false };
      }
      clearPendingReceipt();
      activeAttempt.status = "failed";
      emit("failed", error?.message || "定时发布失败，系统不会自动重试");
      throw error;
    } finally {
      operationInFlight = false;
    }
  });

  ipcMain.handle("xhs:disconnect", async (event) => {
    assertTrustedSender(event);
    if (operationInFlight) throw new Error("小红书同步或提交正在进行，当前不能退出账号");
    if (readPendingReceipt()) throw new Error("上一次发布结果仍待确认，核对并解除锁定后才能退出账号");
    loginWatchVersion += 1;
    if (creatorWindow && !creatorWindow.isDestroyed()) creatorWindow.close();
    await creatorSession().clearStorageData({
      storages: ["cookies", "localstorage", "indexdb", "cachestorage", "serviceworkers"],
    });
    await creatorSession().clearCache();
    await removeAttemptFiles(activeAttempt);
    activeAttempt = null;
    return { connected: false, hasSavedSession: false, accountName: "", url: "" };
  });

  ipcMain.handle("xhs:resolve-pending", async (event, resolution) => {
    assertTrustedSender(event);
    if (operationInFlight) throw new Error("小红书操作正在进行中");
    if (!['published', 'not_published'].includes(resolution)) throw new Error("待确认状态处理参数无效");
    const receipt = readPendingReceipt();
    if (!receipt) throw new Error("没有待人工确认的发布记录");
    const state = creatorWindow && !creatorWindow.isDestroyed()
      ? await readPageState().catch(() => ({ connected: false, hasSavedSession: true, accountName: receipt.accountName, url: "" }))
      : { connected: false, hasSavedSession: true, accountName: receipt.accountName, url: "" };
    clearPendingReceipt();
    if (activeAttempt?.id === receipt.id) {
      activeAttempt.status = resolution === "published" ? "submitted" : "failed";
      activeAttempt.cancelled = false;
    }
    return { ...state, pendingReceipt: null, resolution };
  });

  return {
    close: async () => {
      await removeAttemptFiles(activeAttempt);
      if (creatorWindow && !creatorWindow.isDestroyed()) creatorWindow.destroy();
    },
  };
}

module.exports = {
  FINAL_CONFIRMATION,
  MAX_SCHEDULE_DELAY_MS,
  MIN_SCHEDULE_DELAY_MS,
  comparePreparedSnapshot,
  formatScheduleTime,
  isConfirmedPublishResult,
  parseDataUrl,
  registerXhsAutomation,
  validatePublishRequest,
};
