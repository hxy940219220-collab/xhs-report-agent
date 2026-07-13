const { app, BrowserWindow, dialog, shell, ipcMain, safeStorage, session } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { registerXhsAutomation } = require("./xhs-automation.cjs");
const { hostMatches, providerChatOptions } = require("./ai-request-options.cjs");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
let mainWindow = null;

const settingsPath = () => path.join(app.getPath("userData"), "ai-settings.json");
const activeAIRequests = new Set();
let cachedAISecret = { encryptedKey: "", audience: "", apiKey: "", attempted: false, error: "" };
let keychainAccessAttempted = false;
const assertTrustedSender = (event) => {
  const expectedUrl = pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
  if (event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== expectedUrl) throw new Error("拒绝非应用主页面调用桌面能力");
};

function readStoredAISettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return { baseUrl: "https://api.openai.com/v1", model: "", systemPrompt: "", encryptedKey: "" };
  }
}

function readPrivateAISettings() {
  const stored = readStoredAISettings();
  if (!stored.encryptedKey) return { ...stored, apiKey: "" };
  const audience = String(stored.baseUrl || "").trim().replace(/\/+$/, "");
  if (cachedAISecret.encryptedKey === stored.encryptedKey && cachedAISecret.audience === audience && cachedAISecret.attempted) {
    if (cachedAISecret.error) throw new Error(cachedAISecret.error);
    return { ...stored, apiKey: cachedAISecret.apiKey };
  }
  if (!safeStorage.isEncryptionAvailable()) return { ...stored, apiKey: "" };
  if (keychainAccessAttempted) throw new Error("本次运行已访问过系统钥匙串。为避免再次请求密码，请完全退出 App 后重试");
  keychainAccessAttempted = true;
  cachedAISecret = { encryptedKey: stored.encryptedKey, audience, apiKey: "", attempted: true, error: "" };
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(stored.encryptedKey, "base64"));
    let apiKey = decrypted;
    try {
      const payload = JSON.parse(decrypted);
      if (payload?.v === 2 && typeof payload.apiKey === "string") {
        if (payload.audience !== audience) throw new Error("audience_mismatch");
        apiKey = payload.apiKey;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "audience_mismatch") {
        cachedAISecret.error = "API Key 与当前接口地址不匹配，请重新填写对应服务商的 Key";
        throw new Error(cachedAISecret.error);
      }
      // Legacy versions stored only the raw key. A newly saved key is bound to its API address.
    }
    cachedAISecret.apiKey = apiKey;
    return { ...stored, apiKey };
  } catch {
    if (cachedAISecret.error) throw new Error(cachedAISecret.error);
    cachedAISecret.error = "未能读取系统钥匙串。本次运行不会再次请求密码；请完全退出 App 后重试，或重新保存 API Key";
    throw new Error(cachedAISecret.error);
  }
}

function publicAISettings() {
  const settings = readStoredAISettings();
  return {
    baseUrl: settings.baseUrl || "https://api.openai.com/v1",
    model: settings.model || "",
    systemPrompt: settings.systemPrompt || "",
    hasApiKey: Boolean(settings.encryptedKey),
  };
}

function resolveEndpoint(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  let endpoint;
  try {
    endpoint = new URL(normalized);
  } catch {
    throw new Error("接口地址格式不正确，请检查是否包含 https:// 和正确的 /v1 路径");
  }
  const isLocal = endpoint.protocol === "http:" && (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost");
  if (endpoint.search || endpoint.hash) throw new Error("接口地址不能包含查询参数或页面片段，请只填写服务商提供的基础地址");
  if (endpoint.username || endpoint.password || (endpoint.protocol !== "https:" && !isLocal)) {
    throw new Error("接口地址必须使用 HTTPS，本机调试地址除外");
  }
  return endpoint;
}

const MAX_NON_STREAM_BYTES = 2_000_000;
const MAX_STREAM_TRANSPORT_BYTES = 16_000_000;
const MAX_STREAM_CONTENT_BYTES = 1_000_000;
const MAX_STREAM_EVENT_BYTES = 4_000_000;

function looksLikeEventStream(value) {
  const prefix = value.slice(0, 8_192).replace(/^\uFEFF/, "");
  return /(?:^|\r?\n)data:/i.test(prefix);
}

async function requestChatCompletion({ baseUrl, apiKey, model, messages, temperature, maxTokens, timeoutMs = 90_000, stream = false }) {
  const base = resolveEndpoint(baseUrl);
  if (!apiKey) throw new Error("API Key 为空，请填写后再测试");
  if (!String(model || "").trim()) throw new Error("模型名称为空，请填写模型 ID");
  let response;
  const startedAt = Date.now();
  const endpoint = new URL("chat/completions", `${base.toString().replace(/\/+$/, "")}/`);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  if (hostMatches(endpoint.hostname, "xiaomimimo.com")) headers["api-key"] = apiKey;
  const usesCompletionTokenLimit = hostMatches(endpoint.hostname, "xiaomimimo.com")
    || hostMatches(endpoint.hostname, "minimaxi.com")
    || hostMatches(endpoint.hostname, "openai.com");
  const supportsTemperature = !usesCompletionTokenLimit;
  const tokenLimit = maxTokens
    ? (usesCompletionTokenLimit ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens })
    : {};
  const requestBody = { model: String(model).trim(), stream, ...tokenLimit, messages };
  if (supportsTemperature && Number.isFinite(temperature)) requestBody.temperature = temperature;
  // V4 Flash otherwise spends most of the request on a reasoning stream. Copy editing
  // needs the final JSON only, so disable thinking to reduce latency and transport size.
  Object.assign(requestBody, providerChatOptions(endpoint.hostname, model));
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error(`接口连接超时（${Math.round(timeoutMs / 1000)} 秒），请检查地址、网络或服务状态`);
    throw new Error(`无法连接接口：${error?.message || "网络请求失败"}`);
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("AI 接口没有返回可读取的响应");
  const cancelReader = () => reader.cancel().catch(() => undefined);
  const decoder = new TextDecoder();
  let responseText = "";
  let receivedBytes = 0;
  let isEventStream = /text\/event-stream/i.test(response.headers.get("content-type") || "");
  if (!stream && !isEventStream && declaredLength > MAX_NON_STREAM_BYTES) {
    await cancelReader();
    throw new Error("AI 接口最终文本过大，已停止读取");
  }
  let streamBuffer = "";
  let streamBufferBytes = 0;
  let streamContent = "";
  let streamContentBytes = 0;
  let streamModel = "";
  let streamDone = false;
  let streamError = "";
  let streamFatalError = "";
  const consumeStreamEvent = (rawEvent) => {
    const event = rawEvent.replace(/\r\n/g, "\n");
    const data = event.split("\n")
      .filter((line) => line.trimStart().startsWith("data:"))
      .map((line) => line.trimStart().slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return;
    if (data === "[DONE]") {
      streamDone = true;
      return;
    }
    try {
      const chunk = JSON.parse(data);
      if (chunk?.error) {
        streamError = String(chunk.error.message || chunk.error.code || "流式响应返回错误").slice(0, 500);
        streamFatalError = streamError;
        return;
      }
      streamModel = String(chunk?.model || streamModel);
      const delta = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content;
      if (typeof delta === "string") {
        streamContent += delta;
        streamContentBytes += Buffer.byteLength(delta, "utf8");
        if (streamContentBytes > MAX_STREAM_CONTENT_BYTES) {
          streamFatalError = "AI 接口最终文本过大，已停止读取";
        }
      }
    } catch {
      // Ignore keepalive or provider-specific non-JSON SSE lines.
    }
  };
  const appendStreamText = (text) => {
    streamBuffer += text;
    streamBufferBytes += Buffer.byteLength(text, "utf8");
    if (streamBufferBytes > MAX_STREAM_EVENT_BYTES) streamFatalError = "AI 接口单个流式事件异常过大，已停止读取";
  };
  const consumeStreamEvents = (flush = false) => {
    while (streamBuffer) {
      const lfBoundary = streamBuffer.indexOf("\n\n");
      const crlfBoundary = streamBuffer.indexOf("\r\n\r\n");
      let boundary = -1;
      let delimiterLength = 0;
      if (lfBoundary >= 0 && (crlfBoundary < 0 || lfBoundary < crlfBoundary)) {
        boundary = lfBoundary;
        delimiterLength = 2;
      } else if (crlfBoundary >= 0) {
        boundary = crlfBoundary;
        delimiterLength = 4;
      }
      if (boundary < 0 && !flush) break;
      const consumedLength = boundary < 0 ? streamBuffer.length : boundary + delimiterLength;
      const event = boundary < 0 ? streamBuffer : streamBuffer.slice(0, boundary);
      const consumed = streamBuffer.slice(0, consumedLength);
      streamBuffer = streamBuffer.slice(consumedLength);
      streamBufferBytes = Math.max(0, streamBufferBytes - Buffer.byteLength(consumed, "utf8"));
      if (event) consumeStreamEvent(event);
      if (streamFatalError || streamDone) break;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      const text = decoder.decode(value, { stream: true });
      if (!isEventStream && stream) {
        responseText += text;
        if (looksLikeEventStream(responseText)) {
          isEventStream = true;
          appendStreamText(responseText);
          responseText = "";
        }
      } else if (isEventStream) {
        appendStreamText(text);
      } else {
        responseText += text;
      }
      const transportLimit = isEventStream ? MAX_STREAM_TRANSPORT_BYTES : MAX_NON_STREAM_BYTES;
      if (receivedBytes > transportLimit) {
        await cancelReader();
        throw new Error(isEventStream ? "AI 接口流式传输异常过大，已停止读取" : "AI 接口最终文本过大，已停止读取");
      }
      if (isEventStream) {
        consumeStreamEvents();
        if (streamFatalError) {
          await cancelReader();
          throw new Error(streamFatalError);
        }
        if (streamDone) {
          await cancelReader();
          break;
        }
      }
    }
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      await cancelReader();
      throw new Error(`接口已连接，但模型在 ${Math.round(timeoutMs / 1000)} 秒内没有完成生成。建议换用更快的模型或稍后重试`);
    }
    await cancelReader();
    throw error;
  }
  const tail = decoder.decode();
  if (isEventStream) {
    appendStreamText(tail);
    consumeStreamEvents(true);
    if (streamFatalError) {
      await cancelReader();
      throw new Error(streamFatalError);
    }
  } else {
    responseText += tail;
  }
  const payload = (() => { try { return JSON.parse(responseText); } catch { return {}; } })();
  if (!response.ok) {
    const detail = String(streamError || payload?.error?.message || "").slice(0, 500);
    const errorCode = String(payload?.error?.code || payload?.error?.type || "");
    if (response.status === 401 || response.status === 403) throw new Error(`API Key 验证失败（${response.status}）${detail ? `：${detail}` : ""}`);
    if (response.status === 404 && /model/i.test(`${errorCode} ${detail || ""}`)) throw new Error(`模型不存在或当前 Key 无权使用：${detail || model}`);
    if (response.status === 404) throw new Error(`接口路径不存在（404），请检查服务商要求的基础地址${detail ? `：${detail}` : ""}`);
    if (response.status === 400 && /model/i.test(String(detail || ""))) throw new Error(`模型不可用：${detail}`);
    if (response.status === 429) throw new Error(`请求过于频繁或额度受限（429）${detail ? `：${detail}` : ""}`);
    if (response.status === 402) throw new Error(`账户余额或额度不足（402）${detail ? `：${detail}` : ""}`);
    if (response.status >= 500) throw new Error(`服务商暂时不可用（${response.status}）${detail ? `：${detail}` : ""}`);
    throw new Error(detail || `AI 接口请求失败（${response.status}）`);
  }
  if (streamError) throw new Error(streamError);
  const content = isEventStream ? streamContent : payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("接口已响应，但模型没有返回文本，请检查模型是否兼容 Chat Completions");
  return { content: content.trim(), latencyMs: Date.now() - startedAt, responseModel: String(streamModel || payload?.model || model) };
}

ipcMain.handle("ai:get-settings", (event) => { assertTrustedSender(event); return publicAISettings(); });
ipcMain.handle("ai:save-settings", (event, next) => {
  assertTrustedSender(event);
  const current = readStoredAISettings();
  const nextBaseUrl = String(next.baseUrl || "").trim().replace(/\/+$/, "");
  const newKey = typeof next.apiKey === "string" ? next.apiKey.trim() : "";
  if (current.encryptedKey && current.baseUrl && current.baseUrl !== nextBaseUrl && !newKey) {
    throw new Error("接口地址已变更，请重新填写对应的 API Key");
  }
  const reusesCachedKey = Boolean(
    newKey
    && current.encryptedKey
    && current.baseUrl === nextBaseUrl
    && cachedAISecret.encryptedKey === current.encryptedKey
    && cachedAISecret.audience === nextBaseUrl
    && cachedAISecret.apiKey === newKey,
  );
  const shouldEncryptNewKey = Boolean(newKey && !reusesCachedKey);
  if (shouldEncryptNewKey && !safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法启用安全存储，API Key 未保存");
  if (shouldEncryptNewKey && keychainAccessAttempted) throw new Error("当前输入的是另一条 API Key。为避免再次请求本机密码，请完全退出 App 后再更换；如果只切换模型，请保留 API Key 输入框为空");
  if (shouldEncryptNewKey) keychainAccessAttempted = true;
  let encryptedKey = String(current.encryptedKey || "");
  if (shouldEncryptNewKey) {
    try {
      encryptedKey = safeStorage.encryptString(JSON.stringify({ v: 2, apiKey: newKey, audience: nextBaseUrl })).toString("base64");
    } catch {
      throw new Error("API Key 未写入系统钥匙串。本次运行不会再次请求密码，请完全退出 App 后重试");
    }
    cachedAISecret = { encryptedKey, audience: nextBaseUrl, apiKey: newKey, attempted: true, error: "" };
  }
  const stored = {
    baseUrl: nextBaseUrl,
    model: String(next.model || "").trim(),
    systemPrompt: String(next.systemPrompt || ""),
    encryptedKey,
  };
  fs.writeFileSync(settingsPath(), JSON.stringify(stored, null, 2), { mode: 0o600 });
  return publicAISettings();
});
ipcMain.handle("ai:test-connection", async (event, next) => {
  assertTrustedSender(event);
  if (activeAIRequests.has(event.sender.id)) throw new Error("已有 AI 请求正在处理中");
  const current = readStoredAISettings();
  const nextBaseUrl = String(next.baseUrl || "").trim().replace(/\/+$/, "");
  const newKey = typeof next.apiKey === "string" ? next.apiKey.trim() : "";
  if (!newKey && current.baseUrl && current.baseUrl !== nextBaseUrl) throw new Error("接口地址已变更，请填写这个接口对应的 API Key");
  const apiKey = newKey || readPrivateAISettings().apiKey;
  activeAIRequests.add(event.sender.id);
  try {
    const result = await requestChatCompletion({
      baseUrl: nextBaseUrl,
      apiKey,
      model: next.model,
      stream: true,
      maxTokens: 64,
      timeoutMs: 60_000,
      messages: [{ role: "user", content: "这是连接测试。请只回复 OK。" }],
    });
    return { ok: true, latencyMs: result.latencyMs, model: result.responseModel, reply: result.content.slice(0, 80) };
  } finally {
    activeAIRequests.delete(event.sender.id);
  }
});
ipcMain.handle("ai:clear-key", (event) => {
  assertTrustedSender(event);
  const current = readStoredAISettings();
  cachedAISecret = { encryptedKey: "", audience: "", apiKey: "", attempted: false, error: "" };
  const { keyOrigin: _legacyKeyOrigin, ...withoutLegacyOrigin } = current;
  fs.writeFileSync(settingsPath(), JSON.stringify({ ...withoutLegacyOrigin, encryptedKey: "" }, null, 2), { mode: 0o600 });
  return publicAISettings();
});
ipcMain.handle("ai:generate-copy", async (_event, request) => {
  assertTrustedSender(_event);
  if (activeAIRequests.has(_event.sender.id)) throw new Error("已有 AI 请求正在处理中");
  if (String(request.systemPrompt || "").length + String(request.userPrompt || "").length > 120_000) throw new Error("发送给 AI 的内容过长，请缩短提示词后重试");
  const settings = readPrivateAISettings();
  if (!settings.apiKey) throw new Error("请先在 AI 接入设置中填写 API Key");
  activeAIRequests.add(_event.sender.id);
  try {
    const result = await requestChatCompletion({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      temperature: 0.55,
      stream: true,
      maxTokens: 2_400,
      timeoutMs: 180_000,
      messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
      ],
    });
    return result.content;
  } finally {
    activeAIRequests.delete(_event.sender.id);
  }
});

const xhsAutomation = registerXhsAutomation({
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  assertTrustedSender,
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f2f1ed",
    title: "研报笔记 Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(path.join(__dirname, "../dist/index.html"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const expectedUrl = pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
    if (url !== expectedUrl) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  createWindow();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void xhsAutomation.close();
});
