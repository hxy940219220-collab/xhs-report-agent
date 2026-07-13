import type { Draft, ReportFile } from "./types";
import { createStyledPost } from "./contentRules";

const samplePages = [
  {
    pageNumber: 12,
    title: "市场进入加速期",
    text: "2025 年中国生成式 AI 企业服务市场规模预计达到 308 亿元，同比增长 84%。企业采购重点从模型参数转向可量化的业务结果。",
    tone: "coral",
  },
  {
    pageNumber: 18,
    title: "预算流向应用层",
    text: "应用层预算占比由 31% 提升至 47%。知识管理、客服与营销内容成为前三大落地场景。",
    tone: "blue",
  },
  {
    pageNumber: 26,
    title: "三类玩家形成分工",
    text: "基础模型厂商、垂直解决方案商和企业内部团队正在形成新的协作边界，交付能力比单点模型能力更重要。",
    tone: "green",
  },
  {
    pageNumber: 34,
    title: "ROI 成为核心门槛",
    text: "超过六成受访企业要求 AI 项目在 12 个月内证明投资回报，数据治理和流程改造是最常见的延期原因。",
    tone: "yellow",
  },
];

function pageArt(title: string, text: string, tone: string, page: number) {
  const colors: Record<string, string> = {
    coral: "#e6573e",
    blue: "#315c8d",
    green: "#39705b",
    yellow: "#b7862c",
  };
  const accent = colors[tone];
  const escaped = (value: string) => value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="980" viewBox="0 0 760 980">
  <rect width="760" height="980" fill="#f8f7f2"/><rect x="0" width="18" height="980" fill="${accent}"/>
  <text x="66" y="78" fill="#797871" font-family="Arial" font-size="17">2025 中国企业 AI 应用趋势报告</text>
  <text x="66" y="158" fill="#171816" font-family="Arial" font-size="42" font-weight="700">${escaped(title)}</text>
  <rect x="66" y="207" width="628" height="2" fill="#d9d7ce"/>
  <text x="66" y="274" fill="${accent}" font-family="Arial" font-size="92" font-weight="700">${page === 12 ? "84%" : page === 18 ? "47%" : page === 26 ? "3 类" : "12 月"}</text>
  <rect x="66" y="344" width="520" height="26" rx="4" fill="${accent}" opacity=".14"/>
  <rect x="66" y="392" width="602" height="26" rx="4" fill="#e5e3dc"/>
  <rect x="66" y="440" width="460" height="26" rx="4" fill="#e5e3dc"/>
  <rect x="66" y="510" width="628" height="256" rx="8" fill="${accent}" opacity=".09"/>
  <path d="M102 700 C180 654 230 680 306 602 S470 660 640 548" fill="none" stroke="${accent}" stroke-width="8"/>
  <circle cx="306" cy="602" r="10" fill="${accent}"/><circle cx="640" cy="548" r="10" fill="${accent}"/>
  <text x="66" y="836" fill="#565650" font-family="Arial" font-size="20">${escaped(text.slice(0, 28))}</text>
  <text x="66" y="878" fill="#565650" font-family="Arial" font-size="20">${escaped(text.slice(28, 58))}</text>
  <text x="650" y="930" fill="#929189" font-family="Arial" font-size="17">P.${page}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function assetArt(label: string, value: string, tone: string, variant: number) {
  const colors: Record<string, string> = { coral: "#e6573e", blue: "#315c8d", green: "#39705b", yellow: "#b7862c" };
  const accent = colors[tone];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
    <rect width="960" height="640" fill="#f7f5ef"/><text x="62" y="80" font-family="Arial" font-size="25" fill="#6f706a">2025 企业 AI 应用趋势</text>
    <text x="62" y="164" font-family="Arial" font-size="48" font-weight="700" fill="#18201c">${label}</text>
    <text x="62" y="280" font-family="Arial" font-size="106" font-weight="700" fill="${accent}">${value}</text>
    <path d="M80 ${520 - variant * 18} C220 ${470 - variant * 22} 300 500 420 400 S650 430 870 ${290 - variant * 16}" fill="none" stroke="${accent}" stroke-width="13" stroke-linecap="round"/>
    <line x1="70" y1="548" x2="890" y2="548" stroke="#d4d2ca" stroke-width="2"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const sampleReport: ReportFile = {
  kind: "pdf",
  name: "2025中国企业AI应用趋势报告.pdf",
  size: 18_700_000,
  pageCount: 48,
  pages: samplePages.map((page, index) => ({
    pageNumber: page.pageNumber,
    text: `${page.title}。${page.text}`,
    imageUrl: pageArt(page.title, page.text, page.tone, page.pageNumber),
    selected: index < 3,
  })),
  assets: samplePages.map((page, index) => ({
    id: `sample-asset-${page.pageNumber}`,
    pageNumber: page.pageNumber,
    imageUrl: assetArt(page.title, index === 0 ? "84%" : index === 1 ? "47%" : index === 2 ? "3 类" : "12 月", page.tone, index),
    width: 960,
    height: 640,
    selected: index < 3,
    source: "embedded" as const,
  })),
  extractedText: samplePages.map((page) => page.text).join("\n"),
};

const sampleEvidence = [
  { page: 12, text: "2025 年中国生成式 AI 企业服务市场规模预计达到 308 亿元，同比增长 84%" },
  { page: 18, text: "应用层预算占比由 31% 提升至 47%，知识管理、客服与营销内容成为前三大落地场景" },
  { page: 26, text: "基础模型厂商、垂直解决方案商和企业内部团队正在形成新的协作边界" },
  { page: 34, text: "超过六成受访企业要求 AI 项目在 12 个月内证明投资回报" },
  { page: 38, text: "企业采购决策从模型参数比较转向业务场景适配、数据安全与交付能力" },
  { page: 40, text: "知识管理与智能客服进入规模化应用阶段，营销内容仍保持较快增长" },
  { page: 43, text: "行业竞争重点从通用能力转向垂直数据、工作流整合与持续服务效率" },
  { page: 46, text: "预算正在向能够量化效率提升和收入贡献的项目集中" },
  { page: 22, text: "67%的业务负责人更关注工具能否嵌入现有流程，而不是单独比较模型参数" },
  { page: 29, text: "一线员工对知识检索、会议总结和客服辅助的使用需求最明确" },
  { page: 31, text: "企业用户选择解决方案时，数据安全、部署成本和交付周期是三项核心因素" },
  { page: 41, text: "应用趋势正从单点助手转向跨部门工作流，项目价值也从节省时间扩展到收入增长" },
  { page: 44, text: "行业机会正在向具备垂直数据、场景经验和持续运营能力的服务商集中" },
  { page: 47, text: "下一阶段的增长方向是把人工智能能力沉入业务系统，并用可量化指标持续复盘" },
];
const sampleStyledPost = createStyledPost("2025 中国企业 AI 应用趋势报告", sampleEvidence, sampleReport);

export const sampleDraft: Draft = {
  titles: [
    "🤖企业AI趋势：84%增长开始算回报",
    "📈企业AI洞察：应用层预算升至47%",
    "🔍企业AI落地：六成项目一年内要回报",
  ],
  selectedTitle: 0,
  body: sampleStyledPost.body,
  tags: sampleStyledPost.tags,
  sources: sampleEvidence.map((point) => ({ page: point.page, quote: point.text })),
};
