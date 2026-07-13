function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeCoverTitle(title: string, sourceLabel = "") {
  let normalized = title
    .replace(/^[^\p{L}\p{N}\u3400-\u9fff]+/u, "")
    .replace(/[！!]+$/g, "")
    .trim();
  normalized = normalized.replace(/^来源[\s_｜|:：/\-]*/i, "");
  if (sourceLabel.trim()) {
    normalized = normalized.replace(
      new RegExp(`[【\\[（(]?\\s*${escapeRegExp(sourceLabel.trim())}\\s*(?:报告)?[】\\]）)]?`, "gi"),
      "",
    );
  }
  return normalized
    .replace(/(?:^|[｜|])\s*来源\s*(?:报告)?\s*(?:$|[｜|])/gi, "")
    .replace(/[_｜|]{2,}/g, " ")
    .replace(/^[\s_｜|:：/\-【】\[\]（）()]+|[\s_｜|:：/\-【】\[\]（）()]+$/g, "")
    .trim() || "行业趋势报告";
}

function translatedSubject(value: string) {
  const subjects: [RegExp, string][] = [
    [/功能性?饮料/, "FUNCTIONAL BEVERAGES"],
    [/健康饮料市场/, "HEALTH BEVERAGE MARKET"],
    [/健康饮料/, "HEALTH BEVERAGES"],
    [/无糖饮料/, "SUGAR-FREE BEVERAGES"],
    [/植物基饮料/, "PLANT-BASED BEVERAGES"],
    [/饮料市场/, "BEVERAGE MARKET"],
    [/工业软件市场/, "INDUSTRIAL SOFTWARE MARKET"],
    [/工业软件/, "INDUSTRIAL SOFTWARE"],
    [/生成式\s*AI/i, "GENERATIVE AI"],
    [/企业\s*AI/i, "ENTERPRISE AI"],
    [/人工智能/, "ARTIFICIAL INTELLIGENCE"],
    [/服饰市场/, "APPAREL MARKET"],
    [/服饰/, "APPAREL"],
    [/鞋靴/, "FOOTWEAR"],
    [/美妆/, "BEAUTY"],
    [/年轻人消费/, "YOUTH CONSUMPTION"],
    [/消费趋势/, "CONSUMER TRENDS"],
  ];
  return subjects.find(([pattern]) => pattern.test(value))?.[1] ?? "INDUSTRY MARKET";
}

function translatedAmount(value: string) {
  const amount = Number.parseFloat(value);
  if (/万亿/.test(value)) return `RMB ${amount} TRILLION`;
  if (/亿元|亿/.test(value)) {
    const billions = amount / 10;
    return `RMB ${Number.isInteger(billions) ? billions : billions.toFixed(1)} BILLION`;
  }
  if (/万元/.test(value)) {
    const millions = amount / 100;
    const display = Number.isInteger(millions)
      ? String(millions)
      : millions.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `RMB ${display} MILLION`;
  }
  if (/万/.test(value)) return `${amount * 10} THOUSAND`;
  return value.replace(/\s/g, "");
}

export function translateCoverTitleToEnglish(title: string) {
  const normalized = normalizeCoverTitle(title).replace(/\s+/g, "");
  const amount = normalized.match(
    /^(.+?)(突破|达到|超过)(\d+(?:\.\d+)?(?:万亿|亿元|万元|亿|万))(?:[，,]?(.*))?$/,
  );
  if (amount) {
    const subject = translatedSubject(amount[1]);
    const plural = /BEVERAGES|CATEGORIES|TRENDS/.test(subject);
    const predicate = amount[2] === "达到"
      ? plural ? "REACH" : "REACHES"
      : amount[2] === "超过"
        ? plural ? "EXCEED" : "EXCEEDS"
        : plural ? "SURPASS" : "SURPASSES";
    const growth = /仍在增长|持续增长|增长没停/.test(amount[4] ?? "")
      ? ` AND ${plural ? "KEEP" : "KEEPS"} GROWING`
      : "";
    return `${subject} ${predicate} ${translatedAmount(amount[3])}${growth}`;
  }

  const share = normalized.match(/^(?:(20\d{2})年?)?(.+?)占比(超|超过|达到|约)?(\d+(?:\.\d+)?%)$/);
  if (share) {
    const prefix = share[1] ? `IN ${share[1]}, ` : "";
    const qualifier = /超|超过/.test(share[3] ?? "") ? "OVER " : /约/.test(share[3] ?? "") ? "ABOUT " : "";
    const subject = /创新品类/.test(share[2]) ? "INNOVATIVE CATEGORIES" : translatedSubject(share[2]);
    const predicate = /BEVERAGES|CATEGORIES|TRENDS/.test(subject) ? "ACCOUNT FOR" : "ACCOUNTS FOR";
    return `${prefix}${subject} ${predicate} ${qualifier}${share[4]}`;
  }

  const respondent = normalized.match(/^过去一年(\d+(?:\.\d+)?%)受访者(喝过|购买过|使用过|选择)(.+)$/);
  if (respondent) {
    const action = respondent[2] === "喝过" ? "DRANK" : respondent[2] === "购买过" ? "BOUGHT" : respondent[2] === "使用过" ? "USED" : "CHOSE";
    return `${respondent[1]} OF RESPONDENTS ${action} ${translatedSubject(respondent[3])} IN THE PAST YEAR`;
  }

  if (/新趋势(?:公开|报告)?$/.test(normalized)) {
    if (/年轻人消费/.test(normalized)) return "NEW YOUTH CONSUMER TRENDS";
    return `NEW TRENDS IN THE ${translatedSubject(normalized)}`;
  }

  const percent = normalized.match(/(\d+(?:\.\d+)?%)/)?.[1];
  const growth = /增长|增速/.test(normalized) ? " GROWTH" : " OUTLOOK";
  return `${translatedSubject(normalized)}${percent ? `: ${percent}` : ""}${growth}`;
}
