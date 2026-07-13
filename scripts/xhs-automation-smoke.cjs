const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const {
  comparePreparedSnapshot,
  formatScheduleTime,
  isConfirmedPublishResult,
  parseDataUrl,
  validatePublishRequest,
} = require("../electron/xhs-automation.cjs");

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const scheduleAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
const validRequest = {
  projectId: "smoke-project",
  title: "健康饮料市场出现新机会",
  content: "一份面向行业从业者的趋势摘要，聚焦品类变化、消费场景与增长机会。",
  tags: ["行业报告", "行业洞察", "健康饮料", "消费趋势", "饮料行业", "市场分析", "商业洞察", "消费人群", "产品趋势", "创业机会"],
  images: [onePixelPng],
  scheduleAt: scheduleAt.toISOString(),
  groupStrategy: "smallest",
};

const normalized = validatePublishRequest(validRequest);
assert.equal(normalized.tags.length, 10);
assert.equal(normalized.images.length, 1);
assert.equal(parseDataUrl(onePixelPng, 0).extension, "png");
assert.match(formatScheduleTime(scheduleAt), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
assert.equal(formatScheduleTime(new Date("2026-07-13T02:15:00.000Z")), "2026-07-13 10:15");

assert.throws(
  () => validatePublishRequest({ ...validRequest, scheduleAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }),
  /1 小时至 14 天/,
);
assert.throws(
  () => validatePublishRequest({ ...validRequest, tags: [...validRequest.tags.slice(0, 9), "错误 标签"] }),
  /不能包含空格/,
);
assert.equal(isConfirmedPublishResult({
  beforeUrl: "https://creator.xiaohongshu.com/publish/publish?source=official",
  afterUrl: "https://creator.xiaohongshu.com/publish/publish?source=official",
  beforeBodyText: "首页 笔记管理 数据看板",
  bodyText: "首页 笔记管理 数据看板",
}), false);

const expectedSnapshot = {
  title: validRequest.title,
  content: validRequest.content,
  tags: validRequest.tags,
  imageCount: 1,
  schedule: "2026-07-14 10:00",
  group: { name: "观察家的报告分享群2", count: 132, countDisambiguated: true },
};
const actualSnapshot = {
  title: validRequest.title,
  content: `${validRequest.content}\n\n${validRequest.tags.map((tag) => `#${tag}`).join(" ")}`,
  imageCount: 1,
  schedule: "2026-07-14 10:00",
  hasScheduledButton: true,
  hasGroupPlaceholder: false,
  selectedGroupText: "观察家的报告分享群2",
};
assert.equal(comparePreparedSnapshot(actualSnapshot, expectedSnapshot).ok, true);
assert.equal(comparePreparedSnapshot({ ...actualSnapshot, content: actualSnapshot.content.slice(0, 40) }, expectedSnapshot).ok, false);
assert.equal(comparePreparedSnapshot({ ...actualSnapshot, selectedGroupText: "观察家的报告分享群1" }, expectedSnapshot).ok, false);
assert.equal(comparePreparedSnapshot({ ...actualSnapshot, selectedGroupText: "观察家的报告分享群2 499人" }, expectedSnapshot).ok, false);

const automationSource = readFileSync(require.resolve("../electron/xhs-automation.cjs"), "utf8");
const scheduleSource = automationSource.slice(
  automationSource.indexOf("async function setSchedule"),
  automationSource.indexOf("async function verifyPrepared"),
);
assert.doesNotMatch(scheduleSource, /keyCode:\s*["']ENTER["']/, "定时时间输入不能通过 Enter 提交表单");
assert.equal(isConfirmedPublishResult({
  beforeUrl: "https://creator.xiaohongshu.com/publish/publish?source=official",
  afterUrl: "https://creator.xiaohongshu.com/publish/publish?source=official",
  beforeBodyText: "编辑页",
  bodyText: "定时发布成功",
}), true);
assert.equal(isConfirmedPublishResult({
  beforeUrl: "https://creator.xiaohongshu.com/publish/publish?source=official",
  afterUrl: "https://creator.xiaohongshu.com/home",
  beforeBodyText: "编辑页",
  bodyText: "",
}), false);
assert.equal(isConfirmedPublishResult({
  beforeUrl: "https://creator.xiaohongshu.com/publish/publish?source=official",
  afterUrl: "https://creator.xiaohongshu.com/error",
  beforeBodyText: "编辑页",
  bodyText: "发布失败",
}), false);
assert.equal(isConfirmedPublishResult({
  beforeUrl: "https://creator.xiaohongshu.com/publish/publish?source=official",
  afterUrl: "https://creator.xiaohongshu.com/login",
  beforeBodyText: "编辑页",
  bodyText: "扫码登录",
}), false);
assert.equal(isConfirmedPublishResult({
  beforeUrl: "https://creator.xiaohongshu.com/publish/publish?source=official",
  afterUrl: "https://creator.xiaohongshu.com/publish/publish?source=official",
  beforeBodyText: "定时发布成功",
  bodyText: "定时发布成功",
}), false);

console.log("XHS automation safety smoke tests passed");
