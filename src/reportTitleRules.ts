const KNOWN_SOURCES = /炼丹炉|艾瑞|易观|德勤|麦肯锡|贝恩|波士顿咨询|尼尔森|凯度|益普索|QuestMobile|巨量引擎|秒针|克劳锐|CBNData|哔哩哔哩|甲子光年/i;
const SOURCE_WORDS = /炼丹炉|艾瑞|易观|德勤|麦肯锡|贝恩|波士顿咨询|尼尔森|凯度|益普索|QuestMobile|巨量引擎|秒针|克劳锐|CBNData|哔哩哔哩|甲子光年|研究院|咨询|数据中心|研究中心|研究所|智库|证券|协会|大学/i;

export function extractReportSource(fileName: string, reportText = "") {
  const baseName = fileName.replace(/\.(pdf|docx)$/i, "").trim();
  const bracketed = baseName.match(/^[【\[]([^】\]]{2,20})[】\]]/)?.[1];
  if (bracketed && SOURCE_WORDS.test(bracketed)) return bracketed;
  const firstPart = baseName.split(/[_｜|]+/)[0]?.trim() ?? "";
  if ((baseName.includes("_") || baseName.includes("｜") || baseName.includes("|")) && SOURCE_WORDS.test(firstPart)) {
    return firstPart.replace(/^(?:来源|出品)[：:\s]*/i, "").slice(0, 20) || "报告来源";
  }
  const knownSource = reportText.match(KNOWN_SOURCES)?.[0];
  if (knownSource) return knownSource;
  const credited = reportText.match(/(?:来源|出品|发布机构|研究机构)[：:\s]*([^\n。；]{2,24})/)?.[1]?.trim();
  if (credited) return credited.slice(0, 20);
  const institution = reportText.match(/([A-Za-z\u3400-\u9fff]{2,16}(?:研究院|研究中心|数据中心|研究所|智库|证券|协会|大学))/)?.[1];
  if (institution) return institution.slice(0, 20);
  return "报告来源";
}

export function extractReportRecency(value: string) {
  const compact = value.replace(/\s+/g, "");
  const matched = compact.match(/(20\d{2})年?(?:第?([一二三四1234])季度|Q([1-4])|([上下])半年)/i);
  if (!matched) {
    const year = compact.match(/20\d{2}(?=年|[/.-]\d{1,2}|[\u3400-\u9fffA-Za-z])/)?.[0];
    return year ? `${year}年` : "";
  }
  const quarterMap: Record<string, string> = { 一: "Q1", 二: "Q2", 三: "Q3", 四: "Q4", "1": "Q1", "2": "Q2", "3": "Q3", "4": "Q4" };
  if (matched[2]) return `${matched[1]}${quarterMap[matched[2]]}`;
  if (matched[3]) return `${matched[1]}Q${matched[3]}`;
  return `${matched[1]}${matched[4]}半年`;
}

export function extractReportTitle(fileName: string) {
  const baseName = fileName
    .replace(/\.(pdf|docx)$/i, "")
    .replace(/[【\[]?(?:完整版|正式版|最终版|发布版|高清版)[】\]]?/g, "")
    .trim();
  const parts = baseName.split(/[_｜|]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && (SOURCE_WORDS.test(parts[0]) || /^20\d{2}/.test(parts[1]))) {
    parts.shift();
  }
  let title = parts.join("") || baseName;
  title = title
    .replace(/^[【\[]([^】\]]{1,16})[】\]]/, (match, prefix) => SOURCE_WORDS.test(prefix) ? "" : match)
    .replace(/^(?:来源|出品)[：:\s]*/i, "")
    .replace(/[—–_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (Array.from(title).length > 28) {
    title = title
      .replace(/(?:最新|深度|权威|重磅|完整)版?/g, "")
      .replace(/行业深度研究报告$/g, "行业报告")
      .replace(/市场深度研究报告$/g, "市场报告")
      .trim();
  }
  return title || "行业趋势报告";
}

export function translateReportTitleToEnglish(title: string) {
  const normalized = title.replace(/\s+/g, "").replace(/[：:，,。]/g, "");
  const exactRules: [RegExp, string][] = [
    [/^社交媒体中的[「『“\"《]圈层种草机[」』”\"》]人格全解析$/, 'THE "NICHE COMMUNITY SEEDING MACHINE" PERSONA ON SOCIAL MEDIA: A COMPLETE ANALYSIS'],
    [/^宠物食品市场消费趋势报告$/, "PET FOOD MARKET & CONSUMER TRENDS REPORT"],
    [/^宠物主粮用户需求变化$/, "CHANGES IN PET STAPLE FOOD CONSUMER NEEDS"],
    [/^健康饮料市场消费趋势洞察(?:报告)?$/, "HEALTH BEVERAGE MARKET & CONSUMER TREND INSIGHTS"],
    [/^(20\d{2})年?年轻人消费趋势报告$/, "$1 YOUTH CONSUMER TRENDS REPORT"],
    [/^健康饮料市场(?:趋势|洞察)?报告$/, "HEALTH BEVERAGE MARKET REPORT"],
    [/^工业软件市场(?:规模|发展|趋势)?报告$/, "INDUSTRIAL SOFTWARE MARKET REPORT"],
    [/^(20\d{2})年?中国企业AI应用趋势报告$/i, "$1 CHINA ENTERPRISE AI APPLICATION TRENDS REPORT"],
  ];
  const exact = exactRules.find(([pattern]) => pattern.test(normalized));
  if (exact) return normalized.replace(exact[0], exact[1]);

  const phrases: [RegExp, string][] = [
    [/圈层种草机/g, " NICHE COMMUNITY SEEDING MACHINE "],
    [/社交媒体/g, " SOCIAL MEDIA "],
    [/圈层/g, " NICHE COMMUNITY "],
    [/种草机/g, " SEEDING MACHINE "],
    [/人格/g, " PERSONA "],
    [/全解析/g, " COMPLETE ANALYSIS "],
    [/生成式人工智能/g, " GENERATIVE ARTIFICIAL INTELLIGENCE "],
    [/安全检测认证/g, " SAFETY TESTING AND CERTIFICATION "],
    [/发展与商业化落地/g, " DEVELOPMENT AND COMMERCIALIZATION "],
    [/商业化落地/g, " COMMERCIALIZATION "],
    [/应用技术/g, " APPLICATION TECHNOLOGY "],
    [/储能系统/g, " ENERGY STORAGE SYSTEM "],
    [/生成式AI/gi, " GENERATIVE AI "],
    [/企业AI/gi, " ENTERPRISE AI "],
    [/人工智能/g, " ARTIFICIAL INTELLIGENCE "],
    [/工业软件/g, " INDUSTRIAL SOFTWARE "],
    [/企业/g, " ENTERPRISE "],
    [/健康饮料/g, " HEALTH BEVERAGE "],
    [/功能饮料/g, " FUNCTIONAL BEVERAGE "],
    [/宠物食品/g, " PET FOOD "],
    [/宠物主粮/g, " PET STAPLE FOOD "],
    [/用户需求/g, " CONSUMER NEEDS "],
    [/年轻人/g, " YOUTH "],
    [/消费者/g, " CONSUMER "],
    [/服饰/g, " APPAREL "],
    [/美妆/g, " BEAUTY "],
    [/餐饮/g, " FOOD SERVICE "],
    [/旅游/g, " TRAVEL "],
    [/中国/g, " CHINA "],
    [/全球/g, " GLOBAL "],
    [/应用趋势/g, " APPLICATION TRENDS "],
    [/消费趋势/g, " CONSUMER TRENDS "],
    [/发展趋势/g, " DEVELOPMENT TRENDS "],
    [/发展/g, " DEVELOPMENT "],
    [/趋势洞察/g, " TREND INSIGHTS "],
    [/市场规模/g, " MARKET SIZE "],
    [/市场/g, " MARKET "],
    [/行业/g, " INDUSTRY "],
    [/消费/g, " CONSUMER "],
    [/趋势/g, " TRENDS "],
    [/需求/g, " NEEDS "],
    [/变化/g, " CHANGES "],
    [/洞察/g, " INSIGHTS "],
    [/研究/g, " RESEARCH "],
    [/技术/g, " TECHNOLOGY "],
    [/应用/g, " APPLICATION "],
    [/商业化/g, " COMMERCIALIZATION "],
    [/落地/g, " DEPLOYMENT "],
    [/与/g, " AND "],
    [/分析/g, " ANALYSIS "],
    [/白皮书/g, " WHITE PAPER "],
    [/报告/g, " REPORT "],
  ];
  let translated = normalized;
  for (const [pattern, replacement] of phrases) translated = translated.replace(pattern, replacement);
  translated = translated
    .replace(/[「」『』“”'\"《》【】()[\]]/g, " ")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return translated || "INDUSTRY REPORT";
}

export function reportSocialTopic(reportTitle: string) {
  const quoted = reportTitle.match(/[「『“\"《]([^」』”\"》]{2,10})[」』”\"》]/)?.[1]?.trim();
  if (quoted) return quoted;
  const known = reportTitle.match(/健康饮料|功能饮料|工业软件|企业AI|生成式AI|人工智能|年轻人消费|服饰|美妆|餐饮|旅游/)?.[0];
  if (known) return known === "功能饮料" ? "健康饮料" : known;
  const compact = reportTitle
    .replace(/20\d{2}(?:年|版)?/g, "")
    .replace(/(?:行业|市场)?(?:消费)?(?:趋势|研究|分析|洞察)*(?:报告|白皮书)?$/g, "")
    .replace(/\s+/g, "")
    .trim();
  const semanticCore = compact.match(/^(.{2,8}?)(?=安全|市场|行业|消费|趋势|发展|研究|分析|报告|白皮书)/)?.[1];
  return semanticCore || compact || "行业趋势";
}

function safeSocialTitle(emoji: string, topic: string, section: "趋势" | "洞察", detail: string) {
  const topicVariants = [
    topic,
    topic.replace(/^全球/, "").replace(/(?:系统|市场)$/, ""),
    topic.replace(/^企业/, ""),
  ];
  const detailVariants = [detail, detail.replace(/市场(?=或达)/g, "")];
  for (const nextTopic of topicVariants) {
    for (const nextDetail of detailVariants) {
      const candidate = `${emoji}${nextTopic}${section}：${nextDetail}`;
      if (Array.from(candidate).length <= 20) return candidate;
    }
  }
  const compactTopic = Array.from(topic.replace(/[「」『』“”\s]/g, "")).slice(0, 8).join("") || "行业趋势";
  const fallbackSuffix = emoji === "📈" ? "趋势" : emoji === "🔍" ? "核心洞察" : "全解析";
  return `${emoji}${compactTopic}${fallbackSuffix}`;
}

function reportTitleFallback(reportTitle: string, emoji: string) {
  const quoted = reportTitle.match(/[「『“\"《]([^」』”\"》]{2,10})[」』”\"》]/)?.[1]?.trim();
  if (quoted && /社交媒体/.test(reportTitle) && /人格/.test(reportTitle)) {
    if (emoji === "📈") return `${emoji}${quoted}：社交种草逻辑`;
    if (emoji === "🔍") return `${emoji}社交媒体种草：圈层人格`;
    return `${emoji}${quoted}：人格全解析`;
  }
  const topic = reportSocialTopic(reportTitle);
  const suffix = emoji === "📈" ? "趋势变化" : emoji === "🔍" ? "核心看点" : "全解析";
  const candidate = `${emoji}${topic}：${suffix}`;
  if (Array.from(candidate).length <= 20) return candidate;
  return safeSocialTitle(emoji, topic, "洞察", suffix);
}

export function hasGenericReportTitles(titles: string[]) {
  return titles.length === 3 && titles.every((title) => /^[📊📈🔍]行业报告解读$/u.test(title.trim()));
}

function metricSubject(value: string, topic: string) {
  const cleaned = value
    .replace(/预计20\d{2}年?|20\d{2}年?|过去一年|近一年/g, "")
    .replace(/^(?:其中|报告显示|数据显示)/, "")
    .replace(/创新品类/g, "新品类")
    .replace(topic, "");
  return Array.from(cleaned).slice(-5).join("");
}

function forecastYear(value: string) {
  return value.match(/(?:预计|预测|到|至)(20\d{2})年?/)?.[1]
    ?? value.match(/(20\d{2})年?[^，。；]{0,14}(?:预计|预测|有望|将(?:达到|突破))/)?.[1];
}

function amountSubject(value: string, amountIndex: number, topic: string) {
  const prefix = value.slice(0, amountIndex).split(/[，。；:：、]/).at(-1) ?? "";
  const cleaned = prefix
    .replace(/(?:预计|预测|有望|到|至)?20\d{2}年?/g, "")
    .replace(/(?:预计|预测|有望)$/g, "")
    .replace(/规模$/g, "")
    .replace(/[已将]$/g, "")
    .replace(topic, "")
    .replace(/^(?:中国|全球|整体)/, "")
    .trim();
  return Array.from(cleaned).slice(-6).join("");
}

export function buildReportCentricSocialTitle(reportTitle: string, evidence: string | undefined, emoji: string) {
  const topic = reportSocialTopic(reportTitle);
  const text = evidence?.replace(/\s+/g, "") ?? "";
  const amount = text.match(/(?:已|将)?(?:突破|达到|超过)\s*(\d+(?:\.\d+)?\s*(?:万亿|亿元|亿|万))/);
  if (amount) {
    const displayAmount = amount[1].replace(/\s/g, "").replace(/亿元$/, "亿");
    const futureYear = forecastYear(text);
    let subject = amountSubject(text, amount.index ?? 0, topic);
    if ((/饮料/.test(topic) && /饮料/.test(subject))
      || (/AI|人工智能/i.test(topic) && /AI|人工智能/i.test(subject))
      || (/软件/.test(topic) && /软件/.test(subject))) {
      subject = "";
    }
    if (futureYear) return safeSocialTitle(emoji, topic, "趋势", `${futureYear}${subject ? `${subject}` : ""}或达${displayAmount}`);
    const detail = /增长|增速/.test(text)
      ? `${subject ? `${subject}` : ""}${displayAmount}仍在增长`
      : `${subject || "市场"}${text.includes("突破") ? "突破" : "达到"}${displayAmount}`;
    return safeSocialTitle(emoji, topic, "趋势", detail);
  }
  const percent = text.match(/\d+(?:\.\d+)?%/)?.[0];
  const action = text.match(/喝过|饮用过|购买过|使用过|选择/)?.[0];
  if (percent && action && /过去(?:12个月|一年)|近一年/.test(text)) {
    const shortAction = action === "饮用过" ? "喝过" : action;
    return safeSocialTitle(emoji, topic, "洞察", `${percent}的人过去一年${shortAction}`);
  }
  const explicitGrowth = text.match(/(?:同比|环比)(增长|下降|提升)(?:达到|为|约)?(-?\d+(?:\.\d+)?%)/);
  if (explicitGrowth) {
    return safeSocialTitle(emoji, topic, "趋势", `${text.includes("同比") ? "同比" : "环比"}${explicitGrowth[1]}${explicitGrowth[2]}`);
  }
  const metric = text.match(/([^，。；:：、]{2,12}?)(占比|比重|应用率|使用率|渗透率|覆盖率)(为|达到|达|超|超过|约|近乎|近|提升至|升至)?(\d+(?:\.\d+)?%)/);
  if (metric) {
    let subject = metricSubject(metric[1], topic);
    let metricLabel = metric[2];
    if (/创新品类/.test(text)) subject = "新品类";
    if (metricLabel === "使用率" && /高频/.test(metric[1])) subject = "高频";
    if (metricLabel === "应用率" && subject.endsWith("应用")) metricLabel = "率";
    if (!subject && metricLabel !== "应用率") subject = "核心指标";
    const futureYear = forecastYear(text);
    const operator = /超/.test(metric[3] ?? "") ? "超" : /约|近/.test(metric[3] ?? "") ? "约" : "";
    const futureMetric = subject === "新品类" ? subject : `${subject}${metricLabel}`;
    const detail = futureYear
      ? `${futureYear}${futureMetric}${operator}${metric[4]}`
      : `${subject}${metricLabel}${operator}${metric[4]}`;
    return safeSocialTitle(emoji, topic, /用户|消费者|女性|人群/.test(subject) ? "洞察" : "趋势", detail);
  }
  const growth = text.match(/(?:年均增速|年增速|增速|增长率|CAGR)(?:达到|为|约)?(-?\d+(?:\.\d+)?%)/i);
  if (growth) return safeSocialTitle(emoji, topic, "趋势", `增速${growth[1]}`);
  const directGrowth = text.match(/([^，。；:：、]{2,8}?)(增长|提升|上涨|下降)(-?\d+(?:\.\d+)?%)/);
  if (directGrowth) return safeSocialTitle(emoji, topic, "趋势", `${metricSubject(directGrowth[1], topic)}${directGrowth[2]}${directGrowth[3]}`);
  return reportTitleFallback(reportTitle, emoji);
}

export function buildPlainTextPost(title: string, body: string) {
  return `${title.trim()}\n\n${body.trim()}\n`;
}
