import { AI_TARGET_MAX_LENGTH, AI_TARGET_MIN_LENGTH, POST_MAX_LENGTH, POST_MIN_LENGTH } from "./copyLimits";

export type AISettings = {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  hasApiKey: boolean;
};

export type AIProviderId =
  | "siliconflow"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "glm"
  | "minimax"
  | "mimo"
  | "openai"
  | "custom";

export type AIProviderPreset = {
  id: AIProviderId;
  label: string;
  mark: string;
  baseUrl: string;
  model: string;
  note: string;
};

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  { id: "siliconflow", label: "硅基流动", mark: "硅", baseUrl: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V4-Flash", note: "默认使用 DeepSeek V4 Flash；也可自行填写模型广场中的其他 ID" },
  { id: "deepseek", label: "DeepSeek", mark: "DS", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", note: "官方 OpenAI 兼容接口" },
  { id: "qwen", label: "千问百炼", mark: "千", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", note: "中国区通用兼容地址" },
  { id: "kimi", label: "Kimi", mark: "K", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.6", note: "Moonshot 官方接口" },
  { id: "glm", label: "智谱 GLM", mark: "GL", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.1", note: "通用模型接口，非 Coding 套餐" },
  { id: "minimax", label: "MiniMax", mark: "MM", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7", note: "官方 OpenAI 兼容接口" },
  { id: "mimo", label: "小米 MiMo", mark: "Mi", baseUrl: "https://api.xiaomimimo.com/v1", model: "mimo-v2.5-pro", note: "按量 API；Token Plan 请自定义" },
  { id: "openai", label: "OpenAI", mark: "OA", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini", note: "OpenAI 官方接口" },
  { id: "custom", label: "自定义", mark: "+", baseUrl: "", model: "", note: "自行填写兼容地址与模型" },
];

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();

export function inferAIProviderId(baseUrl: string): AIProviderId {
  const normalized = normalizeBaseUrl(baseUrl);
  return AI_PROVIDER_PRESETS.find((provider) => provider.id !== "custom" && normalizeBaseUrl(provider.baseUrl) === normalized)?.id ?? "custom";
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "",
  systemPrompt: "",
  hasApiKey: false,
};

export const REQUIRED_AI_COPY_RULES = `本应用固定输出规范：
- 面向年轻人、职场人、创业者、行业从业者和投资人，语气像行业同事同步关键信息：简洁、直接、有信息量，不煽情、不说“姐妹们、家人们、救命、谁懂啊”，不使用“首先、其次、最后”等汇报式连接词。
- 只使用用户提供的报告事实，不编造数字、案例或结论；不得出现目录、页码、章节、邮箱、网址或 AI 生成说明。常见互联网大公司品牌名使用半拼音半中文形式，例如 dou音、tao宝、jing东、kuai手、xiao红书。
- 必须输出 3 个不超过 20 个中文字符的标题，围绕报告原标题与最新年份/季度；不得使用“行业报告解读”等空泛标题。
- 正文必须有 1–2 句引子，再写 3–5 个信息模块；每个模块另起一段，以“emoji + 【关键词】”开头，模块之间保留一个空行，禁止把全文堆成连续长段落。
- 每个模块用 2–3 句短句或“▫️/✅”条目讲清一个核心观点；全文自然使用约 6–10 个贴合语义的 emoji，不连续堆叠。
- 结尾另起一段，使用“🔭【趋势信号】”“📍【趋势结论】”等客观标题，总结报告呈现的行业变化；禁止使用“我的判断、个人判断、我的看法、我认为、在我看来、个人观点”。
- 正文必须达到 ${POST_MIN_LENGTH}–${POST_MAX_LENGTH} 个非空白字符，优先控制在 ${AI_TARGET_MIN_LENGTH}–${AI_TARGET_MAX_LENGTH} 字；不足时继续补充报告已有的人群、场景、品类、渠道或趋势信息。
- 不输出话题标签，系统会自动补齐 10 个相关标签。不返回 Markdown、代码块或解释，只返回这一固定结构的严格 JSON：{"titles":["标题1","标题2","标题3"],"body":"保留段落换行的正文"}。`;

export const DEFAULT_SYSTEM_PROMPT = `你是一名专业的行业报告解读专家，擅长把复杂商业数据和行业趋势提炼成简洁、可读、可直接发布的小红书图文文案。

【受众定位】
- 男女比例约 4:6，以年轻人、职场人、创业者、行业从业者和投资人为主。
- 他们关心行业动态、市场数据和商业机会，希望快速获取有用信息，不喜欢空话。

【标题要求】
- 输出 3 个备选标题，每个不超过 20 个中文字符。
- 用适合主题的 emoji + 核心结论、反常识数据或关键变化制造点击欲，但必须围绕报告原标题与最新年份/季度，不能写“行业报告解读”等空泛标题。

【正文结构】
- 引子：用 1–2 句话点明这份报告的价值和最值得看的发现，让读者迅速知道为什么值得继续看。
- 正文：分成 3–5 个信息模块，每个模块以“emoji + 【关键词】”作为小标题并另起一段，模块之间保留一个空行。
- 每个模块只讲一个重点，用 2–3 句短句或“▫️/✅”条目说清数据、变化与含义，复杂概念用括号快速解释。
- 结尾：另起一段，用“🔭【趋势信号】”或“📍【趋势结论】”做客观总结，再自然提示完整报告还有更细的人群、品类、渠道或案例。

【语言风格】
- 简洁、直接、不煽情，像行业同事之间同步一份高质量简报。
- 自然使用约 6–10 个贴合语义的 emoji 和“👇、▫️、✅”做视觉引导，但不要连续堆砌；感叹号控制在每 2–3 段最多 1 个。
- 不说“姐妹们、家人们、救命、谁懂啊”，不过度口语化或情绪化。
- 不使用“首先、其次、最后、赋能、助力、引领”等官方腔或汇报腔。

【信息处理原则】
- 只使用用户提供的报告事实，不编造数字、案例或结论；只提炼最核心的数据和观点，不复制原文长段落。
- 不出现页码、目录、章节、邮箱、网址，不透露这是 AI 生成。
- 正文必须达到 ${POST_MIN_LENGTH}–${POST_MAX_LENGTH} 个非空白字符，优先控制在 ${AI_TARGET_MIN_LENGTH}–${AI_TARGET_MAX_LENGTH} 字；不足时继续补充报告已有的人群、场景、品类、渠道或趋势信息，过长时压缩重复表达。
- 结尾禁止使用“我的判断、个人判断、我的看法、我认为、在我看来、个人观点”等主观措辞，要表达报告呈现出的客观趋势。
- 常见互联网大公司品牌名必须按一半拼音一半中文处理，例如 dou音、tao宝、jing东、kuai手、xiao红书。
- 不输出话题标签，系统会根据报告自动补齐 10 个相关标签。

${REQUIRED_AI_COPY_RULES}

只返回严格 JSON：{"titles":["标题1","标题2","标题3"],"body":"正文"}`;

export function parseAICopyResponse(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回格式不正确，请调整系统提示词后重试");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("AI 返回的 JSON 无法解析，请重试");
  }
  const value = parsed as { titles?: unknown; body?: unknown };
  const titles = Array.isArray(value.titles)
    ? value.titles.filter((title): title is string => typeof title === "string" && title.trim().length > 0).slice(0, 3)
    : [];
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (!titles.length || !body) throw new Error("AI 返回内容缺少标题或正文");
  return { titles, body };
}
