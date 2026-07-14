export const secretPatterns = [
  { label: "OpenAI-compatible API Key", expression: "\\bsk-[A-Za-z0-9_-]{16,}\\b" },
  { label: "GitHub token", expression: "\\bgh[pousr]_[A-Za-z0-9]{20,}\\b|\\bgithub_pat_[A-Za-z0-9_]{20,}\\b" },
  { label: "AWS access key", expression: "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b" },
  { label: "Slack token", expression: "\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b" },
  { label: "Private key block", expression: "-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----" },
];

// git grep uses POSIX extended regular expressions, not JavaScript regexes.
// Keep this list deliberately separate so history scans stay portable.
export const historyPatterns = [
  { label: "OpenAI-compatible API Key", expression: "sk-[A-Za-z0-9_-]{16,}" },
  { label: "GitHub token", expression: "gh[pousr]_[A-Za-z0-9]{20,}" },
  { label: "GitHub token", expression: "github_pat_[A-Za-z0-9_]{20,}" },
  { label: "AWS access key", expression: "(AKIA|ASIA)[0-9A-Z]{16}" },
  { label: "Slack token", expression: "xox[baprs]-[A-Za-z0-9-]{10,}" },
  { label: "Private key block", expression: "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----" },
];

export function findSecretLabels(value) {
  const text = String(value || "");
  return secretPatterns
    .filter(({ expression }) => new RegExp(expression).test(text))
    .map(({ label }) => label);
}
