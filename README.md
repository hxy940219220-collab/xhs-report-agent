# 研报笔记 Agent

把 PDF / DOCX 行业报告整理成可审核、可编辑、可导出的小红书图文笔记，并可在人工确认后同步到小红书创作服务平台。

> 当前为 macOS 桌面端 Beta。项目并非小红书官方产品，网页结构变化可能导致发布自动化暂时失效，请始终在官方编辑页完成最终核对。

## 功能

- 本机解析 PDF / DOCX，过滤目录、章节、页码和联系方式等噪声
- 默认用本地规则生成初稿，也可接入 OpenAI Chat Completions 兼容接口优化文案
- 生成 3 个标题、680–900 字正文和 10 个相关标签
- 将常见互联网品牌转换为半拼音半中文写法
- 把 PDF 每一页生成完整高清图片，或提取 DOCX 内嵌图片
- 支持手动裁切 PDF 页面，最多选择 12 张报告图片
- 生成 3:4 编辑刊物风格封面，可编辑并拖动来源、中英文标题
- 导出封面、报告图片、图片顺序和可直接粘贴的纯文本文案
- 本机保存项目组与历史任务，可继续编辑、重命名和删除
- 人工审核后同步标题、正文、标签、图片、群聊和定时发布时间
- 最终发布前再次显示账号、群聊、图片数和北京时间，并要求人工确认

## 技术栈

- Electron 43
- React 19 + TypeScript
- Vite 7
- PDF.js、Mammoth、JSZip
- Playwright（桌面端及发布自动化回归）

## 本地运行

需要 Node.js 20.19+。桌面打包与小红书同步仅支持 macOS。

```bash
git clone https://github.com/hxy940219220-collab/xhs-report-agent.git
cd xhs-report-agent
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。这里是前端预览，不包含 Electron 的密钥存储与小红书同步能力。生产构建：

```bash
npm run build
npm run preview
```

生成 macOS App 与 ZIP：

```bash
npm run package:mac
```

输出位于 `release/`。如需同时复制到桌面，显式运行 `npm run package:mac:desktop`；它会覆盖桌面上的同名 App 和 ZIP。当前使用 ad-hoc 签名，未公证的 App 在其他 Mac 上可能触发 Gatekeeper 提示。

## AI 接入与隐私

默认规则版不需要 API Key。启用 AI 优化时，可在 App 内配置兼容 OpenAI Chat Completions 的服务商、地址与模型。

- API Key 由 Electron `safeStorage` 加密后保存在本机，不进入项目文件；这能避免磁盘明文，但不能抵御已取得同一 macOS 用户权限的恶意进程
- 报告内容只会发送到用户主动配置的第三方 AI 服务
- 仓库不包含任何 API Key、账号 Cookie 或浏览器登录状态
- 不要把真实密钥写入源码、测试脚本、Issue 或日志

## 小红书同步边界

同步不依赖 AI，也不会读取其他浏览器 Cookie。App 会打开独立、可见的官方创作窗口，登录状态会保存在专用浏览器会话中，直到用户在 App 内退出账号。

自动化采用确定性步骤；图片、群聊、定时发布时间或关键控件无法核验时会停止。点击最终发布后不会自动重试，避免产生重复笔记。首次联调建议使用非关键测试账号与测试内容，并逐项核对自动选择的群聊。自动化可能触发平台风控，使用者应遵守平台规则，并自行承担账号操作与内容版权责任。

## 测试

基础检查不需要私有文件：

```bash
npm run build
npm run test:rules
```

公开仓库还提供一个会自行生成合成 PDF 的 macOS 打包回归：

```bash
npm run package:mac
npm run test:packaged
```

`test:health`、`test:social` 等专项 E2E 依赖维护者的专用回归报告，这些样本因版权原因不随仓库分发。实时第三方 API 测试还需要通过当前进程环境临时传入密钥，详见 `scripts/e2e-packaged-ai-live.mjs`。

## 产品边界

- 单份文档最多 120 页、80 MB
- 扫描版 PDF 需要先做 OCR
- 文案质量依赖报告可提取内容，系统不会用无依据内容强行凑稿
- 网页发布能力属于 Beta，平台更新后可能需要维护适配器
- 当前没有服务端队列、团队协作或跨设备同步

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交前请确保：

1. 不包含真实报告、API Key、Cookie、账号信息或本机路径。
2. `npm run build` 与 `npm run test:rules` 通过。
3. 涉及发布自动化的改动保留人工确认、失败即停止和防重复发布机制。

安全问题请不要创建公开 Issue，改用 GitHub 的私密漏洞报告入口，详见 [SECURITY.md](SECURITY.md)。

## License

[MIT](LICENSE)
