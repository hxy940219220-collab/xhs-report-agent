import { analyzePostBody, buildIndustryTags, createStyledPost, finalizePostBody, hasStructuralDraftNoise, isCompleteEvidenceFact, isLegacyGeneratedDraft, isLegacyNoisyGeneratedDraft, isStructuralEvidenceText, isStructuralReportPage, maskRestrictedBrands } from "../src/contentRules";
import { normalizeCoverTitle, translateCoverTitleToEnglish } from "../src/coverRules";
import { DEFAULT_SYSTEM_PROMPT, REQUIRED_AI_COPY_RULES, parseAICopyResponse } from "../src/aiClient";
import { buildPlainTextPost, buildReportCentricSocialTitle, extractReportRecency, extractReportSource, extractReportTitle, hasGenericReportTitles, translateReportTitleToEnglish } from "../src/reportTitleRules";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const report = {
  name: "2026年轻人服饰消费趋势报告.pdf",
  extractedText: "年轻人 消费者 服饰 鞋靴 穿搭 市场趋势 人群洞察",
};
const sourceText = "抖 音、淘宝、京东和快手都是原报告中的平台词，TikTok 也被提到";
const masked = maskRestrictedBrands(sourceText);
assert(masked === "dou音、tao宝、jing东和kuai手都是原报告中的平台词，Tik音 也被提到", "品牌词未按半拼音半中文转换");
const maskedTagBody = finalizePostBody("这是一段用户洞察正文", { name: "小红书用户洞察报告.pdf", extractedText: "小红书用户洞察与社交媒体趋势" });
assert(maskedTagBody.includes("#xiao红书用户") && analyzePostBody(maskedTagBody).restrictedBrands.length === 0, "自动标签重新引入了违禁品牌词");
assert(normalizeCoverTitle("炼丹炉 健康饮料市场新趋势公开", "炼丹炉") === "健康饮料市场新趋势公开", "封面标题没有移除报告来源");
assert(normalizeCoverTitle("哔哩哔哩 2026年轻人消费趋势", "哔哩哔哩") === "2026年轻人消费趋势", "受限品牌来源没有在转换前从封面标题移除");
assert(normalizeCoverTitle("来源 / 炼丹炉 健康饮料市场新趋势公开", "炼丹炉") === "健康饮料市场新趋势公开", "带来源标签的历史标题没有清理干净");
assert(normalizeCoverTitle("【炼丹炉】健康饮料市场新趋势公开", "炼丹炉") === "健康饮料市场新趋势公开", "书名号包裹的来源没有清理干净");
assert(normalizeCoverTitle("健康饮料市场｜炼丹炉报告", "炼丹炉") === "健康饮料市场", "标题中部的来源没有清理干净");
assert(normalizeCoverTitle("健康饮料_市场消费趋势", "公开行业报告") === "健康饮料_市场消费趋势", "真实主题被误判为来源删除");
assert(normalizeCoverTitle("生成式AI_行业趋势报告", "公开行业报告") === "生成式AI_行业趋势报告", "下划线前的真实行业主题被删除");
assert(normalizeCoverTitle("2026_炼丹炉_健康饮料市场新趋势公开", "炼丹炉") === "2026 健康饮料市场新趋势公开", "移除来源后残留连续分隔符");
assert(translateCoverTitleToEnglish("健康饮料市场新趋势公开") === "NEW TRENDS IN THE HEALTH BEVERAGE MARKET", "封面英文副标题没有对应中文标题");
assert(translateCoverTitleToEnglish("功能性饮料突破1700亿元，仍在增长") === "FUNCTIONAL BEVERAGES SURPASS RMB 170 BILLION AND KEEP GROWING", "数据标题英文翻译错误");
assert(translateCoverTitleToEnglish("用户规模突破10万") === "INDUSTRY MARKET SURPASSES 100 THOUSAND", "普通数量单位被错误翻译为人民币");
const parsedAI = parseAICopyResponse('```json\n{"titles":["标题一","标题二","标题三"],"body":"正文内容"}\n```');
assert(parsedAI.titles.length === 3 && parsedAI.body === "正文内容", "AI JSON 结果没有正确解析");
assert(/680–900/.test(DEFAULT_SYSTEM_PROMPT) && /不编造/.test(DEFAULT_SYSTEM_PROMPT), "默认系统提示词缺少长度或事实约束");
assert(/6–10 个/.test(DEFAULT_SYSTEM_PROMPT) && /模块之间保留一个空行/.test(REQUIRED_AI_COPY_RULES), "默认系统提示词缺少 emoji 或模块分段要求");
assert(/趋势信号/.test(REQUIRED_AI_COPY_RULES) && /禁止使用“我的判断/.test(REQUIRED_AI_COPY_RULES), "默认系统提示词缺少客观收尾要求");
const healthReportTitle = extractReportTitle("炼丹炉_健康饮料市场消费趋势洞察.pdf");
assert(extractReportSource("炼丹炉_健康饮料市场消费趋势洞察.pdf") === "炼丹炉", "没有从文件名识别封面报告来源");
assert(extractReportSource("2026_全球电商行业趋势洞察.pdf", "报告由德勤发布") === "德勤", "年份被错误识别为报告来源");
assert(extractReportSource("全球饮品_消费趋势报告.pdf", "来源：艾瑞咨询") === "艾瑞", "主题被错误识别为报告来源");
assert(extractReportRecency("2026年第三季度全球电商趋势") === "2026Q3", "中文季度没有转为紧凑时间标签");
assert(extractReportRecency("2026 Q2 Global Commerce") === "2026Q2", "英文季度没有转为紧凑时间标签");
assert(extractReportRecency("2026全球电商行业趋势洞察") === "2026年", "裸年份没有进入标题时间标签");
assert(healthReportTitle === "健康饮料市场消费趋势洞察", "报告来源没有从封面原标题中移除");
assert(extractReportTitle("2026_健康饮料_市场趋势报告.pdf") === "2026健康饮料市场趋势报告", "报告原标题的年份或主题被误删");
assert(extractReportTitle("全球饮品_消费趋势报告.pdf") === "全球饮品消费趋势报告", "下划线前的真实报告主题被误删");
assert(extractReportTitle("德勤_2026全球消费趋势报告.pdf") === "2026全球消费趋势报告", "已知报告来源没有移除");
assert(extractReportTitle("哔哩哔哩_2026年轻人消费趋势报告.pdf") === "2026年轻人消费趋势报告", "平台来源进入了报告原标题");
assert(extractReportTitle("甲子光年_2026年中国企业AI应用趋势报告.pdf") === "2026年中国企业AI应用趋势报告", "研究机构来源进入了报告原标题");
assert(translateReportTitleToEnglish(healthReportTitle) === "HEALTH BEVERAGE MARKET & CONSUMER TREND INSIGHTS", "报告原标题没有得到对应英文翻译");
const socialPersonaTitle = extractReportTitle("克劳锐_社交媒体中的「圈层种草机」人格全解析.pdf");
assert(socialPersonaTitle === "社交媒体中的「圈层种草机」人格全解析", "圈层人格报告来源没有正确移除");
assert(translateReportTitleToEnglish(socialPersonaTitle) === 'THE "NICHE COMMUNITY SEEDING MACHINE" PERSONA ON SOCIAL MEDIA: A COMPLETE ANALYSIS', "圈层人格报告英文标题不完整");
assert(translateReportTitleToEnglish("社交媒体中的《圈层种草机》人格全解析") === 'THE "NICHE COMMUNITY SEEDING MACHINE" PERSONA ON SOCIAL MEDIA: A COMPLETE ANALYSIS', "书名号版本没有进入完整英文翻译规则");
assert(translateReportTitleToEnglish("宠物食品市场消费趋势报告") === "PET FOOD MARKET & CONSUMER TRENDS REPORT", "常见行业英文标题丢失主题");
assert(buildReportCentricSocialTitle(socialPersonaTitle, "高频使用率近乎100%，三大核心功能并列", "📊") === "📊圈层种草机趋势：高频使用率约100%", "圈层人格报告的完整数据没有生成主题标题");
assert(buildReportCentricSocialTitle(socialPersonaTitle, "情绪供给场、即时转化场与碎片化知识获取地构成核心体验", "📈") === "📈圈层种草机：社交种草逻辑", "圈层人格报告标题没有从主标题拆解");
assert(buildReportCentricSocialTitle(socialPersonaTitle, "用户会通过内容获得认知与情绪价值", "🔍") === "🔍社交媒体种草：圈层人格", "圈层人格报告标题缺少主标题核心语义");
assert(!hasGenericReportTitles(["📊圈层种草机：人格全解析", "📈圈层种草机：社交种草逻辑"]), "正常主题标题被误判为旧版通用标题");
assert(hasGenericReportTitles(["📊行业报告解读", "📈行业报告解读", "🔍行业报告解读"]), "旧版通用标题未被识别");
assert(!hasGenericReportTitles(["📊行业报告解读：我亲手改的标题", "📈行业报告解读", "🔍行业报告解读"]), "用户编辑过的标题会被旧任务迁移覆盖");
const longAiTitle = "2026年中国企业生成式人工智能应用技术发展与商业化落地趋势研究白皮书";
const longAiEnglish = translateReportTitleToEnglish(longAiTitle);
assert(/ENTERPRISE/.test(longAiEnglish) && /GENERATIVE ARTIFICIAL INTELLIGENCE/.test(longAiEnglish) && /APPLICATION TECHNOLOGY/.test(longAiEnglish) && /COMMERCIALIZATION/.test(longAiEnglish), "长报告英文标题丢失关键语义");
assert(buildReportCentricSocialTitle(healthReportTitle, "2025年功能性饮料市场突破1700亿元，年增速超过10%", "🥤") === "🥤健康饮料趋势：1700亿仍在增长", "小红书标题没有围绕报告主题和核心数据");
assert(buildReportCentricSocialTitle(healthReportTitle, "预计2026年创新品类占比超40%", "📈") === "📈健康饮料趋势：2026新品类超40%", "预测品类标题没有保留年份或偏离报告主题");
assert(buildReportCentricSocialTitle(healthReportTitle, "97%的受访者过去一年喝过健康饮料", "🔍") === "🔍健康饮料洞察：97%的人过去一年喝过", "人群标题偏离报告主题");
assert(buildReportCentricSocialTitle("工业软件市场规模报告", "工业软件研发投入比重达到26%", "📈") === "📈工业软件趋势：研发投入比重26%", "工业软件比重证据没有进入标题");
assert(buildReportCentricSocialTitle("企业AI应用趋势报告", "企业AI应用率达到35%", "📈") === "📈企业AI趋势：应用率35%", "企业AI应用率证据没有进入标题");
assert(buildReportCentricSocialTitle("企业AI应用趋势报告", "预计2027年企业AI应用率达到35%", "📈") === "📈企业AI趋势：2027应用率35%", "预测应用率标题丢失指标名");
assert(buildReportCentricSocialTitle("服饰消费趋势报告", "女性用户占比达到58%", "🔍") === "🔍服饰洞察：女性用户占比58%", "女性用户被错误改写为品类");
assert(buildReportCentricSocialTitle("企业AI应用趋势报告", "国产化率26%，同比增长12%", "📈") === "📈企业AI趋势：同比增长12%", "增速标题取错百分比");
assert(buildReportCentricSocialTitle("全球储能系统安全检测认证发展白皮书", "预计2028年检测认证市场将突破860亿元", "📈") === "📈储能趋势：2028检测认证或达860亿", "预测金额标题丢失年份、子市场范围或误写为当前值");
assert(buildReportCentricSocialTitle("企业AI应用趋势报告", "2025年企业服务市场规模预计达到308亿元，同比增长84%", "🤖").includes("2025"), "年份在预计前时预测金额被写成当前值");
assert(buildReportCentricSocialTitle("服饰消费趋势报告", "面料讨论增长149%", "📈") === "📈服饰趋势：面料讨论增长149%", "直接增长证据没有进入标题");
assert(!/[^%\d]42$/.test(buildReportCentricSocialTitle("全球储能系统安全检测认证发展白皮书", "海外项目占比达到42%", "📈")), "未知行业标题被截断并丢失百分号");
assert(buildPlainTextPost("标题", "正文\n#标签") === "标题\n\n正文\n#标签\n", "发布文案不是可直接粘贴的纯文本");
assert(!isCompleteEvidenceFact("4% 功能饮料 / 运动蛋白饮料 电解质饮料 果味 / 风味 / 果汁饮料"), "残缺百分比图例被误判为完整事实");
assert(!isCompleteEvidenceFact("• 4% 功能饮料 / 运动蛋白饮料 电解质饮料"), "带项目符号的残缺百分比被误判为完整事实");
assert(!isCompleteEvidenceFact("功能饮料 4% 运动蛋白饮料 电解质饮料"), "百分比位于中间的图例被误判为完整事实");
assert(!isCompleteEvidenceFact("4% 同比增长"), "缺少主语的百分比增长片段被误判为完整事实");
assert(!isCompleteEvidenceFact("同比增长 4%"), "指标词在前的无主语增长片段被误判为完整事实");
assert(!isCompleteEvidenceFact("品类占比 功能饮料4% 运动蛋白饮料8%"), "带表头的多百分比图例被误判为完整事实");
assert(!isCompleteEvidenceFact("功能饮料占比4% 运动蛋白饮料占比8%"), "多品类百分比图例被误判为完整事实");
assert(isCompleteEvidenceFact("功能饮料和运动蛋白饮料占比分别为4%和8%"), "带分别关系的完整比较事实被误删");
assert(isCompleteEvidenceFact("97%的受访者过去一年喝过健康饮料"), "带完整谓语的百分比事实被误删");
assert(isCompleteEvidenceFact("97%的受访者过去一年饮用过健康饮料"), "饮用过这一有效谓语被误删");
const contentsPage = "CONTENTS 目录 01 第一章 解码HPFD 02 第二章 典型用户案例 03 第三章 行为密码 04 第四章 生命周期管理 CONTENTS";
assert(isStructuralReportPage(contentsPage), "整页目录没有被识别为结构页");
assert(isStructuralEvidenceText("示例研究院邮箱（报告合作需求）：research@example.com"), "联系方式没有被识别为结构噪声");
assert(!isCompleteEvidenceFact("解码HPFD 第一章 CONTENTS 目录 第二章典型用户案例 第三章行为密码"), "章节目录被误判为有效事实");
assert(hasStructuralDraftNoise(`02 消费者为什么买\nCONTENTS 目录 第一章 第二章\nresearch@example.com`), "旧版目录污染正文没有被识别");
assert(!hasStructuralDraftNoise("平台使用率接近100%，用户会在不同平台切换不同角色。"), "正常正文被误判为目录污染");
assert(isLegacyNoisyGeneratedDraft(`02 消费者为什么买\nCONTENTS 目录 第一章 第二章\n03 增量来自哪些品类\n💬 我的判断\nresearch@example.com`), "旧生成器的目录污染正文没有被识别");
assert(!isLegacyNoisyGeneratedDraft("这份报告目录很清晰。第一章讲市场规模，第二章讲用户需求，我认为产品机会最值得关注。"), "普通用户提到目录和章节时会被自动覆盖");
assert(!isCompleteEvidenceFact("第23页数据显示，用户使用率达到98.7%"), "中文页码进入有效事实");
assert(!isCompleteEvidenceFact("P.23 用户使用率达到98.7%"), "英文页码进入有效事实");
assert(isCompleteEvidenceFact("P2P平台用户规模持续增长"), "P2P行业术语被页码规则误删");
assert(isCompleteEvidenceFact("80 后消费者更关注真实体验"), "80后人群事实被裸页码规则误删");
assert(!isCompleteEvidenceFact("23 用户使用率达到98.7%"), "裸页码进入有效事实");
assert(isCompleteEvidenceFact("商品目录正在成为用户寻找新品的重要入口"), "正常语义中的目录被误删");
assert(!isLegacyGeneratedDraft("这是我逐字修改后的正文。我的理解：机会仍在细分场景。"), "正常用户编辑被误判为旧模板");
assert(isLegacyGeneratedDraft("报告里的 4 个核心信号\n数据来源：报告 P.23\n我的理解：值得关注"), "完整旧模板没有被识别");

const points = [
  { page: 3, text: "年轻消费者对服饰面料质感的关注明显提升，相关讨论呈现持续增长" },
  { page: 8, text: "宽松、高腰与垂感版型保持较高关注，舒适和松弛成为重要选择标准" },
  { page: 12, text: "鞋靴品类讨论增长明显，休闲场景与跨场景穿着需求同步升温" },
  { page: 18, text: "女性与年轻群体仍是核心关注人群，消费判断更重视真实体验" },
  { page: 22, text: "针织衫与轻户外单品保持增长，跨场景穿着成为产品创新重点" },
  { page: 26, text: "消费者购买决策同时关注设计、面料、价格与实际穿着体验" },
  { page: 30, text: "品牌竞争从单一流量获取转向产品差异化和稳定复购能力" },
  { page: 34, text: "内容渠道正在影响新品认知，但成交仍取决于产品力与性价比" },
  { page: 38, text: "垂感面料和轻量外套保持较快增长，通勤与休闲之间的场景边界继续变淡" },
  { page: 42, text: "用户评价中对耐穿、易打理和真实上身效果的讨论明显增多" },
];
const styled = createStyledPost("2026年轻人服饰消费趋势", points, report);
assert(styled.body.includes("🔭【趋势信号】") && !styled.body.includes("💬 我的判断"), "规则版正文仍使用主观判断标题");
const finalBody = finalizePostBody(`${styled.body}\n${sourceText}`, report);
const analysis = analyzePostBody(finalBody);
assert(analysis.contentLength >= 400 && analysis.contentLength <= 800, `正文长度不合格：${analysis.contentLength}`);
assert(analysis.tagCount === 10, `标签数量不合格：${analysis.tagCount}`);
assert(analysis.restrictedBrands.length === 0, `仍包含品牌词：${analysis.restrictedBrands.join(",")}`);
assert(/[📌💬👇]/u.test(finalBody), "正文缺少克制的小红书视觉引导符号");
assert(finalBody.includes("#服饰行业") && finalBody.includes("#时尚趋势"), "标签没有优先匹配报告核心行业");

const softwareTags = buildIndustryTags(
  { name: "2026工业软件市场规模报告.pdf", extractedText: "工业软件市场规模持续增长，制造业数字化投入上升，国产化率稳步提高" },
  "消费者、品类、渠道、品牌营销",
);
assert(!softwareTags.some((tag) => /消费|品牌营销|人群/.test(tag)), "标签被生成模板而不是报告原文污染");
assert(softwareTags.includes("工业软件"), "未知行业没有从报告标题生成主题标签");

const softwarePost = createStyledPost(
  "工业软件市场",
  [
    { page: 2, text: "2025年工业软件市场规模达到3200亿元，同比增长12.4%" },
    { page: 4, text: "研发设计类软件规模连续三年增长，国产化率提升至26%" },
    { page: 6, text: "生产控制类软件收入保持增长，头部项目合同金额明显提高" },
    { page: 8, text: "制造业数字化投入占营业收入比重从2.1%提升到2.8%" },
    { page: 10, text: "大型项目交付周期缩短9%，订阅收入占比持续提高" },
    { page: 12, text: "工业软件整体市场预计2028年突破5000亿元" },
    { page: 14, text: "云部署收入连续四年增长，复合增长率达到18%" },
    { page: 16, text: "研发投入强度提高，软件授权收入保持稳定增长" },
    { page: 18, text: "预计2027年云部署收入占工业软件市场的比重将达到35%" },
  ],
  { name: "2026工业软件市场规模报告.pdf", extractedText: "工业软件市场规模持续增长，制造业数字化投入上升，国产化率稳步提高" },
);
assert(!/消费者|消费需求|品类|渠道/.test(softwarePost.body), "纯市场证据被扩写为不存在的消费或品类结论");

const longMarketPost = createStyledPost(
  "工业软件市场",
  Array.from({ length: 24 }, (_, index) => ({
    page: index + 1,
    text: `工业软件市场指标${index + 1}在202${index % 6}年达到${3200 + index * 120}亿元，同比增长${10 + index}.2%，连续三个统计周期保持增长`,
  })),
  { name: "2026工业软件市场规模报告.pdf", extractedText: "工业软件市场规模、增速和国产化率持续变化" },
);
const longMarketAnalysis = analyzePostBody(longMarketPost.body);
assert(longMarketAnalysis.contentLength >= 700 && longMarketAnalysis.contentLength <= 800, `单一维度长报告长度错误：${longMarketAnalysis.contentLength}`);
assert(analyzePostBody(`${longMarketPost.body}\n正文中的#额外标签`).contentLength === longMarketAnalysis.contentLength + 4, "正文内标签被错误计入字数");
assert(!/消费者|消费需求|品类|渠道/.test(longMarketPost.body), "单一维度长报告被扩写到不存在的维度");

const fragmentSafePost = createStyledPost(
  "健康饮料市场",
  [
    { page: 23, text: "4% 功能饮料 / 运动蛋白饮料 电解质饮料 果味 / 风味 / 果汁饮料" },
    { page: 2, text: "健康饮料市场规模达到1200亿元，同比增长11.2%" },
    { page: 4, text: "97%的受访者过去一年喝过健康饮料，日常补水是最常见场景" },
    { page: 6, text: "无糖饮料销售额连续三年增长，复合增长率达到18%" },
    { page: 8, text: "功能性饮料在运动与通勤场景中的购买频次明显提升" },
    { page: 10, text: "消费者选择健康饮料时更关注具体功能、成分说明和实际饮用场景" },
    { page: 12, text: "植物基饮料在早餐与办公室场景中的渗透率持续提高" },
    { page: 14, text: "预计2027年健康饮料在整体饮料市场中的占比将达到35%" },
    { page: 16, text: "产品竞争重点从宽泛的健康概念转向更明确的功能体验" },
  ],
  { name: "健康饮料市场报告.pdf", extractedText: "健康饮料市场、无糖饮料和功能性饮料持续增长" },
);
assert(!fragmentSafePost.body.includes("4%功能饮料") && !fragmentSafePost.body.includes("4% 功能饮料"), "残缺图表片段进入了发布正文");

const socialPersonaPost = createStyledPost(
  "社交媒体中的圈层种草机人格全解析",
  [
    { page: 2, text: "高频情绪供给场、即时转化场与碎片化知识获取地三类功能并列，高频使用率近乎100%" },
    { page: 8, text: "同一个用户在不同平台会呈现不同人格，平台选择取决于当下场景与需求" },
    { page: 12, text: "用户打开社交平台时，同时寻求情绪放松、知识获取和消费决策支持" },
    { page: 18, text: "消费决策会经过熟人验证→看评论→查商品详情→跨平台比价→看用户评价→收藏分享" },
    { page: 22, text: "内容种草从单次曝光转向连续验证，评论、商品详情与用户评价共同影响转化" },
    { page: 28, text: "平台人格并非固定标签，用户会随任务、情绪和关系变化持续切换" },
    { page: 31, text: "即时转化场更接近购买决策，情绪供给场更强调放松和陪伴" },
    { page: 36, text: "碎片化知识获取成为高频需求，用户希望在有限时间内快速获得有用信息" },
    { page: 42, text: "品牌内容需要匹配平台人格，同一套表达难以覆盖不同使用动机" },
    { page: 48, text: "从认知到购买的路径正在变长，用户会反复查看评论、价格和真实体验" },
    { page: 3, text: contentsPage },
    { page: 61, text: "示例研究院邮箱（报告合作需求）：research@example.com" },
  ],
  { name: "克劳锐_社交媒体中的「圈层种草机」人格全解析.pdf", extractedText: "HPFD 社交媒体 平台人格 情绪供给 即时转化 碎片化知识获取 消费决策" },
);
const socialPersonaAnalysis = analyzePostBody(socialPersonaPost.body);
assert(socialPersonaAnalysis.contentLength >= 300 && socialPersonaAnalysis.contentLength <= 800, `社交人格文案长度错误：${socialPersonaAnalysis.contentLength}`);
assert(/同一个人，不同平台人格|用户为什么打开|种草怎样发生/.test(socialPersonaPost.body), "社交人格报告没有按自身主题重新分层");
assert(!/CONTENTS|目录|第[一二三四五六七八九十\d]+章|research@|报告合作/.test(socialPersonaPost.body), "目录、章节或联系方式进入了社交文案");
assert(!/01 市场走到哪了|02 消费者为什么买|03 增量来自哪些品类/.test(socialPersonaPost.body), "社交人格报告仍在套通用四段模板");
assert(["社交媒体", "用户洞察", "平台运营", "内容营销"].every((tag) => socialPersonaPost.tags.includes(tag)), "社交人格标签没有围绕报告主题");

const regionalPost = createStyledPost(
  "城市消费趋势",
  [
    { page: 1, text: "整体消费市场保持增长，年度规模达到1200亿元" },
    { page: 2, text: "一线城市主动搜索占比达到39.72%" },
    { page: 3, text: "二线城市主动搜索占比达到39.12%" },
    { page: 4, text: "年轻用户更关注产品评价与真实体验" },
    { page: 5, text: "消费决策从即时下单转向多渠道信息验证" },
    { page: 6, text: "预计2027年线上消费规模将突破1800亿元" },
  ],
  { name: "城市消费趋势报告.pdf", extractedText: "城市消费 市场规模 用户占比 消费决策" },
);
assert(regionalPost.body.includes("39.72%") && regionalPost.body.includes("39.12%"), `数字不同的相似分群事实被错误去重：${regionalPost.body}`);

console.log(`规则检查通过：${analysis.contentLength} 字，${analysis.tagCount} 个标签，品牌词已转换`);
