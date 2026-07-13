const hostMatches = (hostname, domain) => hostname === domain || hostname.endsWith(`.${domain}`);

function providerChatOptions(hostname, model) {
  const normalizedModel = String(model || "").trim().toLowerCase();
  if (hostMatches(hostname, "siliconflow.cn") && normalizedModel === "deepseek-ai/deepseek-v4-flash") {
    return { enable_thinking: false };
  }
  return {};
}

module.exports = { hostMatches, providerChatOptions };
