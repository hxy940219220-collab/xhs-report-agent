import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CaretLeft,
  CaretRight,
  CaretDown,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Copy,
  CalendarBlank,
  DownloadSimple,
  FileArrowUp,
  FileDoc,
  FilePdf,
  Folder,
  FolderOpen,
  GearSix,
  House,
  Images,
  LinkSimple,
  PaperPlaneTilt,
  PencilSimple,
  DotsSixVertical,
  Plus,
  Scissors,
  Sparkle,
  ShieldCheck,
  Trash,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import JSZip from "jszip";
import ReactCrop, { type PercentCrop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  AI_PROVIDER_PRESETS,
  DEFAULT_AI_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  REQUIRED_AI_COPY_RULES,
  inferAIProviderId,
  parseAICopyResponse,
  type AIProviderPreset,
  type AISettings,
} from "./aiClient";
import {
  analyzePostBody,
  createStyledPost,
  finalizePostBody,
  isLegacyNoisyGeneratedDraft,
  isCompleteEvidenceFact,
  isStructuralEvidenceText,
  isStructuralReportPage,
  maskRestrictedBrands,
  stripPostTags,
} from "./contentRules";
import {
  normalizeCoverTitle,
} from "./coverRules";
import {
  buildPlainTextPost,
  buildReportCentricSocialTitle,
  extractReportRecency,
  extractReportSource,
  extractReportTitle,
  hasGenericReportTitles,
  translateReportTitleToEnglish,
} from "./reportTitleRules";
import {
  extractPdfAssets,
  parseDocument,
  renderPdfCrop,
  renderPdfPagePreview,
} from "./documentParser";
import {
  DEFAULT_GROUP_ID,
  deleteProject,
  deleteProjectGroup,
  getProject,
  listProjectGroups,
  listProjects,
  renameProject,
  saveProject,
  saveProjectGroup,
} from "./projectStore";
import type {
  CoverStyle,
  CoverCustomization,
  CoverTextLayer,
  Draft,
  ProjectGroup,
  ProjectSummary,
  ReportAsset,
  ReportFile,
  XhsConnectionStatus,
  XhsPreparedResult,
  XhsPublishProgress,
  XhsPublishSettings,
} from "./types";
import {
  AI_TARGET_LENGTH,
  AI_TARGET_MAX_LENGTH,
  AI_TARGET_MIN_LENGTH,
  POST_MAX_LENGTH,
  POST_MIN_LENGTH,
} from "./copyLimits";

type Step = "upload" | "copy" | "images" | "review";

const MAX_SELECTED_REPORT_IMAGES = 12;

const steps: { id: Exclude<Step, "upload">; label: string; hint: string }[] = [
  { id: "copy", label: "文案与封面", hint: "生成并确认内容" },
  { id: "images", label: "报告图片", hint: "提取或手动裁切" },
  { id: "review", label: "最终审核", hint: "导出或同步发布" },
];

function bytes(value: number) {
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

function safeFileName(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f-\u009f\\/:*?"<>|]/g, "-")
      .trim()
      .slice(0, 46) || "小红书内容包"
  );
}

function desktopErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "").trim() || fallback;
}

function compactCharacterCount(value: string) {
  return Array.from(value.replace(/\s/g, "")).length;
}

function copySentences(value: string) {
  return (stripPostTags(value).match(/[^。！？!?；;\n]+[。！？!?；;]?/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => compactCharacterCount(sentence) >= 16);
}

function dedupeCopySentences(value: string) {
  const seen = new Set<string>();
  return stripPostTags(value)
    .split(/\n{2,}/)
    .map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter((line) => {
      if (!line) return false;
      const normalized = line.replace(/[\s▫️▪️•·，。！？!?；;：“”'"（）()【】\[\]]/g, "").toLowerCase();
      if (normalized.length < 10 || !seen.has(normalized)) {
        seen.add(normalized);
        return true;
      }
      return false;
    }).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

function compressLongAICopy(value: string) {
  const structured = dedupeCopySentences(value) || stripPostTags(value).trim();
  const blocks = structured.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length >= 4) {
    const trendIndex = blocks.findIndex((block) => /【(?:趋势信号|趋势结论|行业趋势|趋势观察)】/.test(block));
    const endingStart = trendIndex > 0 ? trendIndex : blocks.length - 1;
    const endingBlocks = blocks.slice(endingStart);
    const chosenBlocks = [blocks[0]];
    const middleBlocks = blocks.slice(1, endingStart);
    for (const block of middleBlocks) {
      const fullCandidate = [...chosenBlocks, block, ...endingBlocks].join("\n\n");
      if (compactCharacterCount(fullCandidate) <= AI_TARGET_MAX_LENGTH) {
        chosenBlocks.push(block);
        continue;
      }
      const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const heading = AI_SECTION_HEADING_PATTERN.test(lines[0] ?? "") ? lines.shift() ?? "" : "";
      const shortenedLines: string[] = heading ? [heading] : [];
      for (const sentence of copySentences(lines.join("\n"))) {
        const shortenedBlock = [...shortenedLines, sentence].join("\n");
        const shortenedCandidate = [...chosenBlocks, shortenedBlock, ...endingBlocks].join("\n\n");
        if (compactCharacterCount(shortenedCandidate) > AI_TARGET_MAX_LENGTH) break;
        shortenedLines.push(sentence);
      }
      if (shortenedLines.length > (heading ? 1 : 0)) chosenBlocks.push(shortenedLines.join("\n"));
    }
    const compressedStructured = formatAICopyParagraphs([...chosenBlocks, ...endingBlocks].join("\n\n"));
    if (
      compactCharacterCount(compressedStructured) >= POST_MIN_LENGTH &&
      compactCharacterCount(compressedStructured) <= AI_TARGET_MAX_LENGTH
    ) return compressedStructured;
  }
  const sentences = copySentences(value);
  if (!sentences.length) return stripPostTags(value).trim();
  const ending = sentences.slice(-2);
  const endingKeys = new Set(ending.map((sentence) => sentence.replace(/\s/g, "")));
  const selected: string[] = [];
  for (const sentence of sentences) {
    if (endingKeys.has(sentence.replace(/\s/g, ""))) continue;
    const candidate = [...selected, sentence, ...ending].join("\n");
    if (compactCharacterCount(candidate) > AI_TARGET_MAX_LENGTH) break;
    selected.push(sentence);
  }
  const compressed = [...selected, ...ending].join("\n").trim();
  if (compactCharacterCount(compressed) <= POST_MAX_LENGTH) return compressed;
  const completeSentences: string[] = [];
  for (const sentence of sentences) {
    if (compactCharacterCount([...completeSentences, sentence].join("\n")) > AI_TARGET_MAX_LENGTH) break;
    completeSentences.push(sentence);
  }
  return completeSentences.join("\n").trim();
}

function insertSupplementBeforeObjectiveEnding(value: string, supplement: string) {
  const cleanSupplement = supplement.trim();
  if (!cleanSupplement) return value.trim();
  const blocks = value.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const endingIndex = blocks.findIndex((block) => /【(?:趋势信号|趋势结论|行业趋势|趋势观察)】/.test(block));
  if (endingIndex > 0) {
    blocks.splice(endingIndex, 0, cleanSupplement);
    return blocks.join("\n\n");
  }
  return `${value.trim()}\n\n${cleanSupplement}`;
}

function fitAICopyToRequiredLength(aiBody: string, groundedDraft: string) {
  let result = dedupeCopySentences(aiBody) || stripPostTags(aiBody).trim();
  if (compactCharacterCount(result) > POST_MAX_LENGTH) result = compressLongAICopy(result);
  if (compactCharacterCount(result) >= POST_MIN_LENGTH) return result;
  const candidates = copySentences(groundedDraft);
  let addedHeading = false;
  let supplement = "";
  for (const sentence of candidates) {
    if (compactCharacterCount(result + supplement) >= AI_TARGET_MIN_LENGTH) break;
    const fingerprint = sentence.replace(/\s/g, "").slice(0, 18);
    if (fingerprint && (result + supplement).replace(/\s/g, "").includes(fingerprint)) continue;
    const heading = addedHeading ? "" : "\n\n📌【补充变化】";
    const addition = `${heading}\n▫️ ${sentence}`;
    if (compactCharacterCount(result + supplement + addition) > AI_TARGET_MAX_LENGTH) continue;
    supplement += addition;
    addedHeading = true;
  }
  if (compactCharacterCount(result + supplement) < POST_MIN_LENGTH) {
    const clauses = stripPostTags(groundedDraft).split(/(?<=[，,；;。！？!?])/).map((clause) => clause.trim())
      .filter((clause) => compactCharacterCount(clause) >= 12 && compactCharacterCount(clause) <= 90);
    for (const clause of clauses) {
      if (compactCharacterCount(result + supplement) >= AI_TARGET_MIN_LENGTH) break;
      const fingerprint = clause.replace(/\s/g, "").slice(0, 18);
      if (fingerprint && (result + supplement).replace(/\s/g, "").includes(fingerprint)) continue;
      const addition = `\n▫️ ${clause}`;
      if (compactCharacterCount(result + supplement + addition) > POST_MAX_LENGTH) continue;
      supplement += addition;
    }
  }
  return insertSupplementBeforeObjectiveEnding(result, supplement);
}

const AI_LINE_PREFIX = "[\\p{Extended_Pictographic}▫️▪️•·\\-—\\d.、）)\\s]*";
const AI_OPENING_ARTIFACT_PATTERN = new RegExp(`^(?:${AI_LINE_PREFIX})(?:(?:姐妹们|家人们|救命|谁懂啊)(?:[！!，,、：:\\s]+|$)|(?:首先|其次|最后)[！!，,、：:\\s]+)`, "u");
const AI_INLINE_ARTIFACT_PATTERN = /(^|[。！？!?；;：:，,]\s*)(姐妹们|家人们|救命|谁懂啊|首先|其次|最后)(?=[！!，,、：:\s])/u;
const AI_INLINE_REPORT_REFERENCE_PATTERN = /(?:报告\s*)?第[一二三四五六七八九十百\d]+章(?:指出|提到|显示|认为)[，,、：:\s]*|报告\s*P\.?\s*\d+(?:显示|指出|提到)?[，,、：:\s]*/i;
const AI_SUBJECTIVE_ENDING_PATTERN = /^(?:[\p{Extended_Pictographic}\uFE0F\u200D]\s*)*(?:【\s*)?(?:我的判断|个人判断|个人观点|我的看法|个人看法)(?:\s*】)?[：:]?$/u;
const AI_SECTION_HEADING_PATTERN = /^(?:[\p{Extended_Pictographic}\uFE0F\u200D]\s*)?【[^】]{2,18}】/u;

function formatAICopyParagraphs(value: string) {
  const output: string[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (output.length && output.at(-1) !== "") output.push("");
      continue;
    }
    if (AI_SECTION_HEADING_PATTERN.test(line) && output.length && output.at(-1) !== "") output.push("");
    output.push(line);
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isAIMetadataLine(line: string) {
  if (/(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i.test(line)) return true;
  if (/(?:数据来源|报告合作|联系(?:方式|邮箱)|邮箱)\s*[：:]/i.test(line)) return true;
  return new RegExp(`^(?:${AI_LINE_PREFIX})(?:CONTENTS|目录)(?:[\\s：:]|$)`, "iu").test(line);
}

function sanitizeAICopyBody(value: string) {
  const cleanedLines = stripPostTags(value).split(/\r?\n/).map((rawLine) => {
    let line = rawLine.trim();
    if (!line) return "";
    if (isAIMetadataLine(line)) return "";
    if (AI_SUBJECTIVE_ENDING_PATTERN.test(line)) return "🔭【趋势信号】";
    line = line
      .replace(new RegExp(`^(?:${AI_LINE_PREFIX})第[一二三四五六七八九十百\\d]+章(?:指出|提到|显示|认为)?[，,、：:\\s]*`, "u"), "")
      .replace(new RegExp(AI_INLINE_REPORT_REFERENCE_PATTERN.source, "gi"), "")
      .replace(/第\s*(?:\d+|[一二三四五六七八九十百]+)\s*页/g, "")
      .replace(/(?:报告\s*)?P(?:\.|\s+)\s*\d+(?![A-Za-z])/gi, "")
      .replace(/AI\s*生成/gi, "")
      .replace(AI_OPENING_ARTIFACT_PATTERN, "")
      .replace(new RegExp(AI_INLINE_ARTIFACT_PATTERN.source, "gu"), "$1")
      .replace(/(?:我的判断是|个人判断是|我认为|在我看来|个人观点是|我的看法是|个人看法是)[，,：:]?/g, "从报告信息看，")
      .trim();
    return line;
  });
  return formatAICopyParagraphs(maskRestrictedBrands(cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim()));
}

function hasDisallowedAICopyArtifacts(value: string) {
  return stripPostTags(value).split(/\r?\n/).some((line) => isAIMetadataLine(line.trim()) || AI_OPENING_ARTIFACT_PATTERN.test(line.trim()) || AI_INLINE_ARTIFACT_PATTERN.test(line) || AI_INLINE_REPORT_REFERENCE_PATTERN.test(line))
    || /AI\s*生成/i.test(value)
    || /我的判断|个人判断|我认为|在我看来|个人观点|我的看法|个人看法/.test(value);
}

function extractMaterialNumbers(value: string) {
  const withoutListMarkers = value
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
    .replace(/[0-9]\uFE0F?\u20E3/g, "")
    .replace(/^\s*\d+[.、）)]\s*/gm, "");
  const matches = [...withoutListMarkers.matchAll(/(\d+(?:\.\d+)?)\s*(万亿元|亿元|万元|%|亿|万|元|岁|年|个月|月|倍|人)/g)];
  return matches.map((match) => {
    const rawValue = Number(match[1]);
    const unit = match[2];
    if (unit === "万亿元") return `${rawValue * 10_000}亿元`;
    return `${Number.isFinite(rawValue) ? rawValue : match[1]}${unit}`;
  });
}

function removeUngroundedNumberLines(value: string, groundedNumbers: Set<string>) {
  return stripPostTags(value).split(/\r?\n/).map((line) => {
    const parts = line.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [line];
    return parts.filter((part) => extractMaterialNumbers(part).every((number) => groundedNumbers.has(number))).join("");
  }).filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fitGeneratedTitle(value: string, fallback: string) {
  const normalized = value.trim() || fallback;
  if (Array.from(normalized).length <= 20) return normalized;
  return Array.from(normalized).slice(0, 20).join("").replace(/[：:｜|，,、\s]+$/u, "");
}

function toDateTimeLocalValue(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function defaultScheduleValue() {
  return `${toDateTimeLocalValue(new Date(Date.now() + 24 * 60 * 60 * 1000)).slice(0, 10)}T10:00`;
}

function isValidScheduleValue(value: string) {
  const date = new Date(`${value}:00+08:00`);
  const delay = date.getTime() - Date.now();
  return !Number.isNaN(date.getTime()) && delay >= 60 * 60 * 1000 && delay <= 14 * 24 * 60 * 60 * 1000;
}

function beijingScheduleToIso(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}

function dataUrlToBlob(dataUrl: string) {
  const [meta, body] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);/)?.[1] || "image/png";
  const binary = meta.includes("base64")
    ? atob(body)
    : decodeURIComponent(body);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    output[index] = binary.charCodeAt(index);
  return new Blob([output], { type: mime });
}

function defaultCoverCustomization(report: Pick<ReportFile, "name" | "pages" | "extractedText">): CoverCustomization {
  const title = extractReportTitle(report.name);
  return {
    source: extractReportSource(report.name, `${report.pages[0]?.text ?? ""}\n${report.extractedText.slice(0, 1200)}`),
    title,
    english: translateReportTitleToEnglish(title),
    positions: {
      source: { x: 0, y: 0 },
      title: { x: 0, y: 0 },
      english: { x: 0, y: 0 },
    },
  };
}

function normalizeCoverCustomization(
  report: Pick<ReportFile, "name" | "pages" | "extractedText">,
  value?: Partial<CoverCustomization>,
): CoverCustomization {
  const fallback = defaultCoverCustomization(report);
  const safePosition = (layer: CoverTextLayer) => {
    const position = value?.positions?.[layer];
    return {
      x: Number.isFinite(position?.x) ? Number(position?.x) : 0,
      y: Number.isFinite(position?.y) ? Number(position?.y) : 0,
    };
  };
  return {
    source: typeof value?.source === "string" ? value.source : fallback.source,
    title: typeof value?.title === "string" ? value.title : fallback.title,
    english: typeof value?.english === "string" ? value.english : fallback.english,
    positions: {
      source: safePosition("source"),
      title: safePosition("title"),
      english: safePosition("english"),
    },
  };
}

async function imageToExportBlob(dataUrl: string) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const maxSideScale = Math.min(
    1,
    2160 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const pixelScale = Math.min(
    1,
    Math.sqrt(5_000_000 / (image.naturalWidth * image.naturalHeight)),
  );
  const scale = Math.min(maxSideScale, pixelScale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("图片转换失败");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片导出失败"))),
      "image/jpeg",
      0.9,
    ),
  );
}

function cleanReportTopic(fileName: string) {
  return (
    fileName
      .replace(/\.(pdf|docx)$/i, "")
      .replace(/^[^_]{1,16}_/, "")
      .replace(/20\d{2}(?:年|版)?/g, "")
      .replace(
        /(?:行业|市场)?(?:消费)?(?:趋势|研究|分析)?(?:洞察|报告|白皮书)$/g,
        "",
      )
      .replace(/[_-]+/g, " ")
      .trim() || "行业趋势"
  );
}

function topicEmoji(topic: string) {
  if (/饮料|茶饮|咖啡|食品|餐饮/.test(topic)) return "🥤";
  if (/人工智能|AI|科技|数码/i.test(topic)) return "🤖";
  if (/服饰|时尚|美妆|消费/.test(topic)) return "📈";
  return "📊";
}

function applyRecencyToTitle(title: string, recency: string) {
  if (!recency || title.includes(recency) || title.includes(recency.slice(0, 4))) return title;
  const leading = title.match(/^[^A-Za-z0-9\u3400-\u9fff]+/u)?.[0] ?? "";
  const compactRecency = recency.replace(/年$/, "");
  const body = title.slice(leading.length);
  const [rawTopic, ...detailParts] = body.split("：");
  const topic = rawTopic.replace(/(?:趋势|洞察)$/, "");
  const detail = detailParts.join("：")
    .replace(/的人过去一年喝过/, "近一年喝过")
    .replace(/的人过去一年使用过/, "近一年使用过");
  const candidate = detail
    ? `${leading}${compactRecency}${topic}：${detail}`
    : `${leading}${compactRecency}｜${body}`;
  if (Array.from(candidate).length <= 20) return candidate;
  const shorterTopic = Array.from(topic).slice(0, 6).join("");
  const room = Math.max(3, 19 - Array.from(`${leading}${compactRecency}${shorterTopic}：`).length);
  return `${leading}${compactRecency}${shorterTopic}：${Array.from(detail || body).slice(0, room).join("")}`;
}

function buildDraft(report: ReportFile): Draft {
  const usesDenseChartLines = /社交媒体|圈层种草机|HPFD/i.test(`${report.name}\n${report.extractedText.slice(0, 5000)}`);
  const sourcePages = report.pages.length
    ? report.pages.filter((page) => !isStructuralReportPage(page.text))
    : [{ pageNumber: 1, text: report.extractedText }];
  const candidates = sourcePages.flatMap((page) => {
    const rawLines = page.text
      .split(/\n+/)
      .map((text) => text.trim())
      .filter((text) => text && !isStructuralEvidenceText(text));
    const paragraphs: string[] = [];
    if (usesDenseChartLines) {
      paragraphs.push(...rawLines);
    } else {
      for (let index = 0; index < rawLines.length; index += 1) {
        let paragraph = rawLines[index];
        if (paragraph.length <= 16 && /^核心特征[：:]/.test(rawLines[index + 1] ?? "")) {
          paragraphs.push(`${paragraph}•${rawLines[index + 1]}`);
          index += 1;
          continue;
        }
        if (paragraph.length >= 24 && !/[。！？!?；;]$/.test(paragraph)) {
          let consumed = 0;
          for (let offset = 1; offset <= 2 && index + offset < rawLines.length; offset += 1) {
            const continuation = rawLines[index + offset];
            paragraph += continuation;
            consumed = offset;
            if (/[。！？!?；;]$/.test(continuation) || paragraph.length >= 170) break;
          }
          index += consumed;
        }
        paragraphs.push(paragraph);
      }
    }
    const lines = paragraphs.flatMap((paragraph) =>
      paragraph.split(/[。！？!?]|(?<!\d)\.(?!\d)/).map((text) => text.trim()).filter(Boolean),
    );
    let activePlatform: string | undefined;
    return lines.map((text) => {
      const explicitPlatform = usesDenseChartLines
        ? text.match(/抖音|小红书|哔哩哔哩|B站|快手/)?.[0]
        : undefined;
      if (explicitPlatform) activePlatform = explicitPlatform;
      const shouldAttachPlatform = activePlatform
        && !text.includes(activePlatform)
        && /核心使用场景|情绪供给|即时转化|知识获取|种草|消费决策|兴趣驱动|主动搜索|高频使用率/.test(text);
      return { page: page.pageNumber, text: shouldAttachPlatform ? `${activePlatform}：${text}` : text };
    });
  });
  const ranked = candidates
    .filter(
      (item) =>
        (item.text.length >= 18 || (item.text.length >= 10 && /\d+(?:\.\d+)?(?:%|万亿|亿元|亿|万)/.test(item.text))) &&
        item.text.length <= 180 &&
        !isStructuralEvidenceText(item.text) &&
        isCompleteEvidenceFact(item.text) &&
        !/版权|免责声明|数据来源|仅供参考|目录|品牌名称|炼丹炉指数/.test(
          item.text,
        ) &&
        !/品牌(?:名称|热度|排名)|TOP\s*\d+\s*品牌/i.test(item.text),
    )
    .sort((a, b) => {
      const score = (text: string) =>
        (/\d+(?:\.\d+)?%|\d+(?:\.\d+)?(?:万亿|亿|万)/.test(text)
          ? 40
          : 0) +
        (/增长|市场|渗透|规模|占比|消费者|需求|机会|趋势|驱动/.test(text)
          ? 24
          : 0) +
        (/突破|预计|增长引擎|主力品类|核心关注|成为.*选择/.test(text)
          ? 24
          : 0) +
        (/使用率|高频|核心功能|即时转化|情绪供给|知识获取/.test(text)
          ? 36
          : 0) +
        (/种草|评论|比价|主动搜索|消费决策|用户评价/.test(text)
          ? 30
          : 0) +
        (/核心特征|消费动机|场景偏好|决策逻辑|人群画像/.test(text)
          ? -22
          : 0) +
        Math.min(text.length, 100) / 5;
      return score(b.text) - score(a.text);
    });
  const points: { page: number; text: string }[] = [];
  for (const candidate of ranked) {
    if (points.some((point) => point.text === candidate.text)) continue;
    points.push(candidate);
    if (points.length === 40) break;
  }
  if (points.length < 2)
    throw new Error("文档中的有效内容太少，暂时无法生成可靠文案");
  const topic = cleanReportTopic(report.name);
  const reportTitle = extractReportTitle(report.name);
  const safeReportTitle = maskRestrictedBrands(reportTitle);
  const emoji = topicEmoji(topic);
  const futureEvidence = ranked.find((point) =>
    point.text !== points[0]?.text
    && /(?:预计|预测|有望|将(?:达到|突破))[^。；]{0,80}(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?(?:万亿|亿元|亿|万))/.test(point.text.replace(/\s+/g, "")),
  );
  const scopedEvidence = ranked.find((point) => {
    if (point.text === points[0]?.text) return false;
    const compact = point.text.replace(/\s+/g, "");
    return /(?:过去12个月|过去一年|近一年).*\d+(?:\.\d+)?%|\d+(?:\.\d+)?%.*(?:过去12个月|过去一年|近一年)/.test(compact);
  });
  const compactReportEvidence = report.pages.map((page) => page.text.replace(/\s+/g, "")).join("\n");
  const futureEvidenceText = compactReportEvidence.match(/创新品类[^。；\n]{0,180}预计20\d{2}年占比超\d+(?:\.\d+)?%/)?.[0]
    ?? futureEvidence?.text;
  const scopedEvidenceText = compactReportEvidence.match(/过去(?:12个月|一年)[^。；\n]{0,140}(?:消费者)?占比(?:高达|达到|为)?\d+(?:\.\d+)?%/)?.[0]
    ?? scopedEvidence?.text;
  const strongestEvidence = ranked.find((point) => /高频使用率(?:近乎|近|约)?100%/.test(point.text.replace(/\s+/g, "")))
    ?? ranked.find((point) => /(?:突破|达到|超过)\s*\d+(?:\.\d+)?\s*(?:万亿|亿元|亿|万)/.test(point.text) && /增长|规模|市场/.test(point.text))
    ?? points[0];
  const normalizeGeneratedTitle = (title: string, fallbackEmoji: string) =>
    /圈层种草机|社交媒体/.test(safeReportTitle) && !title.includes("：")
      ? buildReportCentricSocialTitle(safeReportTitle, undefined, fallbackEmoji)
      : title;
  const styled = createStyledPost(topic, points, report);
  if (analyzePostBody(styled.body).contentLength < POST_MIN_LENGTH) {
    throw new Error(`报告中的完整有效信息不足，暂时无法生成 ${POST_MIN_LENGTH}–${POST_MAX_LENGTH} 字的可靠文案`);
  }
  const generatedTitles = [
    normalizeGeneratedTitle(buildReportCentricSocialTitle(safeReportTitle, strongestEvidence?.text, emoji), emoji),
    normalizeGeneratedTitle(buildReportCentricSocialTitle(safeReportTitle, futureEvidenceText ?? points[1]?.text, "📈"), "📈"),
    normalizeGeneratedTitle(buildReportCentricSocialTitle(safeReportTitle, scopedEvidenceText ?? points[2]?.text, "🔍"), "🔍"),
  ];
  const titleMeaning = (title: string) => title.replace(/^[^A-Za-z0-9\u3400-\u9fff]+/u, "");
  const uniqueTitles = generatedTitles.map((title, index, all) =>
    all.findIndex((candidate) => titleMeaning(candidate) === titleMeaning(title)) === index
      ? title
      : buildReportCentricSocialTitle(safeReportTitle, undefined, index === 1 ? "📈" : "🔍"),
  );
  const recency = extractReportRecency(`${report.name}\n${report.pages[0]?.text.slice(0, 800) ?? ""}`);
  const datedTitles = uniqueTitles.map((title) => applyRecencyToTitle(title, recency));
  return {
    titles: datedTitles,
    selectedTitle: 0,
    body: styled.body,
    tags: styled.tags,
    sources: points.map((point) => ({ page: point.page, quote: point.text })),
  };
}

function renderCover(
  title: string,
  pageCount: number,
  style: CoverStyle,
  customization?: CoverCustomization,
  hideEditableText = false,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1440;
  const context = canvas.getContext("2d")!;
  const palettes = {
    signal: {
      bg: "#d9c8e4",
      ink: "#352846",
      accent: "#f5eff7",
      soft: "#b8a3c7",
      label: "LILAC EDITION",
    },
    editorial: {
      bg: "#f1e8d9",
      ink: "#243129",
      accent: "#c94f37",
      soft: "#cfc2af",
      label: "PAPER EDITION",
    },
    data: {
      bg: "#ccd9e6",
      ink: "#183149",
      accent: "#f4dc6b",
      soft: "#9fb2c3",
      label: "FIELD EDITION",
    },
  };
  const palette = palettes[style];
  context.fillStyle = palette.bg;
  context.fillRect(0, 0, 1080, 1440);

  // A restrained, deterministic paper grain avoids the synthetic flatness of
  // template graphics without introducing decorative imagery.
  context.save();
  context.globalAlpha = 0.075;
  context.fillStyle = palette.ink;
  for (let index = 0; index < 260; index += 1) {
    const x = (index * 83 + (index % 7) * 19) % 1080;
    const y = (index * 137 + (index % 11) * 23) % 1440;
    const size = index % 5 === 0 ? 2 : 1;
    context.fillRect(x, y, size, size);
  }
  context.restore();

  const sourceLabel = customization?.source.trim() || "报告来源";
  const branchTitle = maskRestrictedBrands(normalizeCoverTitle(customization?.title || title, sourceLabel));
  const englishTitle = customization?.english.trim() || translateReportTitleToEnglish(branchTitle);
  const layerPosition = (layer: CoverTextLayer) => customization?.positions[layer] ?? { x: 0, y: 0 };
  const coverContentX = 92;
  const coverContentWidth = 1080 - coverContentX * 2;
  const semanticBreaks = (value: string) => {
    const Segmenter = (Intl as typeof Intl & { Segmenter?: new (...args: any[]) => any }).Segmenter;
    const breaks = Segmenter
      ? Array.from(new Segmenter("zh-CN", { granularity: "word" }).segment(value), (part: any) => part.index + part.segment.length)
      : Array.from(value).map((_, index) => index + 1);
    const protectedPhrases = /健康饮料市场|工业软件市场|年轻人消费趋势|消费趋势洞察|企业AI|生成式AI|应用趋势|应用技术|生成式人工智能|商业化落地|安全检测认证|储能系统|研究白皮书|市场规模/g;
    const protectedRanges = Array.from(value.matchAll(protectedPhrases), (match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
    const quotedMidpoints = Array.from(value.matchAll(/[「『“\"《]([^」』”\"》]{4,12})[」』”\"》]/g), (match) =>
      (match.index ?? 0) + 1 + Math.round(Array.from(match[1]).length / 2),
    );
    return [...new Set([...breaks, ...quotedMidpoints])].filter((position) =>
      position > 0
      && position < value.length
      && !protectedRanges.some(([start, end]) => position > start && position < end),
    );
  };
  const fitBranchTitle = (startSize: number, minSize: number, maxWidth: number) => {
    let fitted = { lines: [branchTitle], font: `650 ${startSize}px "PingFang SC", "Hiragino Sans GB", sans-serif` };
    for (let size = startSize; size >= Math.min(minSize, 32); size -= 4) {
      const font = `650 ${size}px "PingFang SC", "Hiragino Sans GB", sans-serif`;
      context.font = font;
      if (context.measureText(branchTitle).width <= maxWidth) return { lines: [branchTitle], font };
      const candidates = semanticBreaks(branchTitle)
        .map((position) => {
          const lines = [branchTitle.slice(0, position), branchTitle.slice(position)];
          const widths = lines.map((line) => context.measureText(line).width);
          return { lines, widths, score: Math.abs(widths[0] - widths[1]) };
        })
        .filter((candidate) => candidate.widths.every((width) => width <= maxWidth))
        .sort((first, second) => first.score - second.score);
      if (candidates[0]) return { lines: candidates[0].lines, font };
      fitted = { lines: [branchTitle], font };
    }
    return fitted;
  };
  const drawEnglishTitle = (
    x: number,
    y: number,
    maxWidth: number,
    font: string,
    lineHeight: number,
  ) => {
    const startSize = Number(font.match(/(\d+)px/)?.[1] ?? 30);
    const words = englishTitle.split(/\s+/);
    let lines = [englishTitle];
    let resolvedFont = font;
    for (let size = startSize; size >= 14; size -= 2) {
      resolvedFont = `600 ${size}px "Avenir Next", Arial, sans-serif`;
      context.font = resolvedFont;
      if (words.length <= 4 && context.measureText(englishTitle).width <= maxWidth) {
        lines = [englishTitle];
        break;
      }
      const candidates = Array.from({ length: words.length - 1 }, (_, index) => index + 1)
        .map((position) => {
          const nextLines = [words.slice(0, position).join(" "), words.slice(position).join(" ")];
          const widths = nextLines.map((line) => context.measureText(line).width);
          const orphanPenalty = words.length >= 5 && (position < 2 || words.length - position < 2) ? 10000 : 0;
          return { lines: nextLines, widths, score: Math.abs(widths[0] - widths[1]) + orphanPenalty };
        })
        .filter((candidate) => candidate.widths.every((width) => width <= maxWidth))
        .sort((first, second) => first.score - second.score);
      if (candidates[0]) {
        lines = candidates[0].lines;
        break;
      }
    }
    context.font = resolvedFont;
    lines.forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
  };

  if (style === "editorial") {
    const sourcePosition = layerPosition("source");
    const titlePosition = layerPosition("title");
    const englishPosition = layerPosition("english");
    const paperTitle = fitBranchTitle(92, 48, coverContentWidth);
    context.strokeStyle = palette.ink;
    context.lineWidth = 2;
    context.strokeRect(72, 72, 936, 1296);
    context.fillStyle = palette.accent;
    context.fillRect(92, 100, 230, 12);
    context.font = '700 24px "Avenir Next", Arial, sans-serif';
    context.fillText("REPORT OBSERVER / EDITION", 92, 164);
    context.textAlign = "right";
    context.font = '700 30px "PingFang SC", sans-serif';
    context.fillText("报告观察家", 988, 164);
    context.textAlign = "left";
    context.fillStyle = palette.accent;
    context.font = '700 22px "PingFang SC", sans-serif';
    if (!hideEditableText) context.fillText(`来源：${sourceLabel}`, 92 + sourcePosition.x, 286 + sourcePosition.y);
    context.fillStyle = palette.ink;
    context.font = paperTitle.font;
    if (!hideEditableText) paperTitle.lines.forEach((line, index) => context.fillText(line, 92 + titlePosition.x, 430 + titlePosition.y + index * 118));
    const deckY = 390 + paperTitle.lines.length * 118;
    if (!hideEditableText) drawEnglishTitle(coverContentX + englishPosition.x, deckY + englishPosition.y, coverContentWidth, '600 30px "Avenir Next", Arial, sans-serif', 42);
    context.fillStyle = palette.accent;
    context.fillRect(92, 1060, 324, 232);
    context.fillStyle = palette.bg;
    context.font = '650 116px "Avenir Next", Arial, sans-serif';
    context.fillText(pageCount > 1 ? String(pageCount) : "01", 124, 1192);
    context.font = '700 18px "Avenir Next", Arial, sans-serif';
    context.fillText(pageCount > 1 ? "PAGES / FULL REPORT" : "DOCUMENT / NOTE", 124, 1244);
    context.fillStyle = palette.ink;
    context.font = '600 29px "PingFang SC", sans-serif';
    context.fillText("精读行业报告", 478, 1128);
    context.fillText("提炼关键趋势", 478, 1176);
    context.font = '500 20px "PingFang SC", sans-serif';
    context.fillText("行业趋势｜市场变化｜商业机会", 478, 1236);
    context.textAlign = "right";
    context.fillText("PAPER EDITION", 988, 1340);
    context.textAlign = "left";
    return canvas.toDataURL("image/png");
  }

  if (style === "data") {
    const sourcePosition = layerPosition("source");
    const titlePosition = layerPosition("title");
    const englishPosition = layerPosition("english");
    const fieldTitle = fitBranchTitle(84, 48, coverContentWidth);
    context.strokeStyle = palette.soft;
    context.lineWidth = 2;
    for (const y of [206, 420, 1036, 1288]) {
      context.beginPath();
      context.moveTo(92, y);
      context.lineTo(988, y);
      context.stroke();
    }
    context.fillStyle = palette.ink;
    context.font = '700 31px "PingFang SC", sans-serif';
    context.fillText("报告观察家", 92, 118);
    context.font = '600 18px "Avenir Next", Arial, sans-serif';
    context.fillText("FIELD NOTES / MARKET INTELLIGENCE", 92, 158);
    context.save();
    context.globalAlpha = 0.12;
    context.textAlign = "right";
    context.font = '700 228px "Avenir Next", Arial, sans-serif';
    context.fillText(pageCount > 1 ? String(pageCount) : "01", 994, 376);
    context.restore();
    context.fillStyle = palette.accent;
    context.font = '700 22px "PingFang SC", sans-serif';
    const sourceBarWidth = Math.min(896, Math.max(160, context.measureText(`来源：${sourceLabel}`).width + 48));
    context.fillRect(92 + sourcePosition.x, 286 + sourcePosition.y, sourceBarWidth, 64);
    context.fillStyle = palette.ink;
    if (!hideEditableText) context.fillText(`来源：${sourceLabel}`, 116 + sourcePosition.x, 327 + sourcePosition.y);
    context.font = fieldTitle.font;
    if (!hideEditableText) fieldTitle.lines.forEach((line, index) => context.fillText(line, 92 + titlePosition.x, 548 + titlePosition.y + index * 108));
    const fieldDeckY = 510 + fieldTitle.lines.length * 108;
    if (!hideEditableText) drawEnglishTitle(coverContentX + englishPosition.x, fieldDeckY + englishPosition.y, coverContentWidth, '600 30px "Avenir Next", Arial, sans-serif', 42);
    context.fillStyle = palette.ink;
    context.font = '650 80px "Avenir Next", Arial, sans-serif';
    context.fillText("01", 92, 1168);
    context.font = '600 21px "PingFang SC", sans-serif';
    context.fillText("市场变化", 92, 1212);
    context.font = '650 80px "Avenir Next", Arial, sans-serif';
    context.fillText("02", 394, 1168);
    context.font = '600 21px "PingFang SC", sans-serif';
    context.fillText("增长信号", 394, 1212);
    context.font = '650 80px "Avenir Next", Arial, sans-serif';
    context.fillText("03", 696, 1168);
    context.font = '600 21px "PingFang SC", sans-serif';
    context.fillText("商业判断", 696, 1212);
    context.textAlign = "right";
    context.fillText("BLUE FIELD EDITION", 988, 1342);
    context.textAlign = "left";
    return canvas.toDataURL("image/png");
  }

  const margin = coverContentX;
  const sourcePosition = layerPosition("source");
  const titlePosition = layerPosition("title");
  const englishPosition = layerPosition("english");
  context.strokeStyle = palette.ink;
  context.globalAlpha = 0.72;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(margin, 228);
  context.lineTo(1080 - margin, 228);
  context.moveTo(margin, 1128);
  context.lineTo(1080 - margin, 1128);
  context.stroke();
  context.globalAlpha = 1;

  context.fillStyle = palette.ink;
  context.font = '700 28px "PingFang SC", "Hiragino Sans GB", sans-serif';
  context.fillText("行业  前沿  洞察", margin, 102);
  context.font = '500 18px "Avenir Next", Arial, sans-serif';
  context.letterSpacing = "2px";
  context.fillText("REPORT / INSIGHT / TREND", margin, 142);
  context.letterSpacing = "0px";

  context.textAlign = "right";
  context.font = '700 30px "PingFang SC", "Hiragino Sans GB", sans-serif';
  context.fillText("报告观察家", 1080 - margin, 102);
  context.font = '600 17px "Avenir Next", Arial, sans-serif';
  context.fillText("REPORT OBSERVER", 1080 - margin, 138);
  context.textAlign = "left";

  context.fillStyle = palette.ink;
  context.font = '600 17px "Avenir Next", Arial, sans-serif';
  context.fillText(palette.label, margin, 276);
  context.textAlign = "right";
  context.fillText("REPORT EDITION", 1080 - margin, 276);
  context.textAlign = "left";

  context.fillStyle = palette.ink;
  context.font = '700 22px "PingFang SC", "Hiragino Sans GB", sans-serif';
  const chipLabel = `来源：${sourceLabel}`;
  const chipWidth = Math.min(896, Math.max(160, context.measureText(chipLabel).width + 56));
  context.beginPath();
  context.roundRect(margin + sourcePosition.x, 330 + sourcePosition.y, chipWidth, 58, 29);
  context.fill();
  context.fillStyle = palette.accent;
  context.font = '700 22px "PingFang SC", "Hiragino Sans GB", sans-serif';
  if (!hideEditableText) context.fillText(chipLabel, margin + 28 + sourcePosition.x, 368 + sourcePosition.y);

  const signalTitle = fitBranchTitle(86, 48, coverContentWidth);
  context.fillStyle = palette.ink;
  context.font = signalTitle.font;
  if (!hideEditableText) signalTitle.lines.forEach((line, index) =>
    context.fillText(line, margin + titlePosition.x, 512 + titlePosition.y + index * 112),
  );

  const englishY = 482 + signalTitle.lines.length * 112;
  context.letterSpacing = "1.4px";
  if (!hideEditableText) drawEnglishTitle(margin + englishPosition.x, englishY + englishPosition.y, coverContentWidth, '600 30px "Avenir Next", Arial, sans-serif', 42);
  context.letterSpacing = "0px";

  context.fillStyle = palette.ink;
  context.font = '650 112px "Avenir Next", Arial, sans-serif';
  context.fillText(pageCount > 1 ? String(pageCount) : "01", margin, 1272);
  context.fillStyle = palette.ink;
  context.font = '700 20px "Avenir Next", Arial, sans-serif';
  context.fillText(pageCount > 1 ? "FULL REPORT / PAGES" : "DOCUMENT / NOTE", 270, 1208);
  context.font = '600 26px "PingFang SC", "Hiragino Sans GB", sans-serif';
  context.fillText("精读行业报告，提炼关键趋势", 270, 1252);
  context.font = '400 20px "PingFang SC", "Hiragino Sans GB", sans-serif';
  context.fillText("行业趋势｜市场变化｜商业机会", 270, 1290);

  context.textAlign = "right";
  context.font = '600 19px "Avenir Next", Arial, sans-serif';
  context.fillText("INDUSTRY REPORT REVIEW", 1080 - margin, 1370);
  context.textAlign = "left";
  return canvas.toDataURL("image/png");
}

export default function AppV2() {
  const [step, setStep] = useState<Step>("upload");
  const [fontRevision, setFontRevision] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [report, setReport] = useState<ReportFile | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [coverStyle, setCoverStyle] = useState<CoverStyle>("signal");
  const [projectStatus, setProjectStatus] = useState<"draft" | "completed">(
    "draft",
  );
  const [history, setHistory] = useState<ProjectSummary[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState(DEFAULT_GROUP_ID);
  const [currentGroupId, setCurrentGroupId] = useState(DEFAULT_GROUP_ID);
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([DEFAULT_GROUP_ID]);
  const [showGroupCreator, setShowGroupCreator] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [coverCustomization, setCoverCustomization] = useState<CoverCustomization | null>(null);
  const [showCoverControls, setShowCoverControls] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiSettings, setAISettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [savedAIConnection, setSavedAIConnection] = useState({ baseUrl: DEFAULT_AI_SETTINGS.baseUrl, model: DEFAULT_AI_SETTINGS.model });
  const [aiKeyInput, setAIKeyInput] = useState("");
  const [isReplacingAIKey, setIsReplacingAIKey] = useState(false);
  const [isSavingAISettings, setIsSavingAISettings] = useState(false);
  const [isTestingAISettings, setIsTestingAISettings] = useState(false);
  const [aiTestResult, setAITestResult] = useState<{ status: "success" | "error"; message: string } | null>(null);
  const [testedAIConnection, setTestedAIConnection] = useState<string | null>(null);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiGenerationPhase, setAIGenerationPhase] = useState<"draft" | "length-repair">("draft");
  const [aiLengthDirection, setAILengthDirection] = useState<"short" | "long">("short");
  const [aiGenerationSeconds, setAIGenerationSeconds] = useState(0);
  const [preAIDraft, setPreAIDraft] = useState<Draft | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseMessage, setParseMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [xhsConnection, setXhsConnection] = useState<XhsConnectionStatus>({
    connected: false,
    hasSavedSession: false,
    accountName: "",
    url: "",
  });
  const [xhsPublishSettings, setXhsPublishSettings] = useState<XhsPublishSettings>({
    scheduleAt: defaultScheduleValue(),
    groupStrategy: "smallest",
  });
  const [xhsProgress, setXhsProgress] = useState<XhsPublishProgress | null>(null);
  const [xhsPrepared, setXhsPrepared] = useState<XhsPreparedResult | null>(null);
  const [xhsPreparedFingerprint, setXhsPreparedFingerprint] = useState("");
  const [isXhsSyncing, setIsXhsSyncing] = useState(false);
  const [isXhsSubmitting, setIsXhsSubmitting] = useState(false);
  const [xhsFinalConfirmed, setXhsFinalConfirmed] = useState(false);
  const [showCropper, setShowCropper] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [cropPage, setCropPage] = useState(1);
  const [crop, setCrop] = useState<PercentCrop>({
    unit: "%",
    x: 10,
    y: 15,
    width: 80,
    height: 60,
  });
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [cropPreviewUrl, setCropPreviewUrl] = useState("");
  const [isCropPreviewLoading, setIsCropPreviewLoading] = useState(false);
  const [assetProgress, setAssetProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropDialogRef = useRef<HTMLDivElement>(null);
  const cropCloseRef = useRef<HTMLButtonElement>(null);
  const assetJobRef = useRef<{
    id: string;
    controller: AbortController;
  } | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const activeGroupIdRef = useRef(DEFAULT_GROUP_ID);
  const cropPreviewJobRef = useRef(0);
  const coverStageRef = useRef<HTMLDivElement>(null);
  const coverDragRef = useRef<{
    layer: CoverTextLayer;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const deletedProjectIdsRef = useRef(new Set<string>());
  const draftRef = useRef<Draft | null>(null);
  const aiRequestRef = useRef(0);
  const pendingTaskOpenRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) setFontRevision((revision) => revision + 1);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!window.reportAgentAI) return;
    void window.reportAgentAI.getSettings().then((settings) => {
      setAISettings(settings);
      setSavedAIConnection({ baseUrl: settings.baseUrl, model: settings.model });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isGeneratingAI) {
      setAIGenerationSeconds(0);
      return;
    }
    setAIGenerationSeconds(0);
    const timer = window.setInterval(() => setAIGenerationSeconds((seconds) => seconds + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [isGeneratingAI]);

  useEffect(() => {
    if (!window.reportAgentXhs) return;
    const unsubscribe = window.reportAgentXhs.onProgress((progress) => {
      setXhsProgress(progress);
      if (progress.stage === "connected") {
        setXhsConnection((current) => ({ ...current, connected: true }));
      }
      if (progress.accountName) {
        setXhsConnection((current) => ({
          ...current,
          connected: true,
          accountName: progress.accountName || current.accountName,
        }));
      }
      if (progress.stage === "failed" || progress.stage === "window_closed") {
        setIsXhsSyncing(false);
        setIsXhsSubmitting(false);
        setXhsPrepared(null);
        setXhsPreparedFingerprint("");
        setXhsFinalConfirmed(false);
      }
    });
    void window.reportAgentXhs.getStatus().then(setXhsConnection).catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    void Promise.all([listProjects(), listProjectGroups()])
      .then(([projects, projectGroups]) => {
        setHistory(projects);
        setGroups(projectGroups);
      })
      .catch(() => {
        setHistory([]);
        setGroups([]);
      });
    return () => assetJobRef.current?.controller.abort();
  }, []);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = coverDragRef.current;
      const stage = coverStageRef.current;
      if (!drag || !stage) return;
      const bounds = stage.getBoundingClientRect();
      const maxX = drag.layer === "source" ? 470 : 96;
      const maxY = drag.layer === "source" ? 900 : 500;
      const nextX = Math.max(-72, Math.min(maxX, drag.originX + (event.clientX - drag.startX) * (1080 / bounds.width)));
      const nextY = Math.max(-260, Math.min(maxY, drag.originY + (event.clientY - drag.startY) * (1440 / bounds.height)));
      setCoverCustomization((current) => current ? {
        ...current,
        positions: {
          ...current.positions,
          [drag.layer]: { x: Math.round(nextX), y: Math.round(nextY) },
        },
      } : current);
      setProjectStatus("draft");
    };
    const handleUp = () => { coverDragRef.current = null; };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, []);

  useEffect(() => {
    activeProjectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!showCropper) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    window.requestAnimationFrame(() => cropCloseRef.current?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowCropper(false);
      if (event.key === "Tab" && cropDialogRef.current) {
        const focusable = Array.from(
          cropDialogRef.current.querySelectorAll<HTMLElement>(
            "button, select, input, [tabindex]:not([tabindex='-1'])",
          ),
        ).filter((element) => !element.hasAttribute("disabled"));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, [showCropper]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2500);
  };

  const normalizeAssetStatus = (nextReport: ReportFile): ReportFile => {
    if (nextReport.kind === "docx")
      return { ...nextReport, assetStatus: "ready", assetProgress: 100 };
    const hasLegacyEmbeddedImages = nextReport.assets.some(
      (asset) => (asset.source as string) === "embedded",
    );
    if (hasLegacyEmbeddedImages && nextReport.sourceData) {
      return {
        ...nextReport,
        assets: nextReport.assets.filter((asset) => asset.source === "crop"),
        assetStatus: "pending",
        assetProgress: 0,
      };
    }
    if (hasLegacyEmbeddedImages && !nextReport.sourceData) {
      return {
        ...nextReport,
        assets: [],
        assetStatus: "error",
        assetProgress: 0,
      };
    }
    if (
      nextReport.assetStatus === "ready" ||
      !nextReport.sourceData ||
      (nextReport.assetStatus === undefined && nextReport.assets.length > 0)
    ) {
      return { ...nextReport, assetStatus: "ready", assetProgress: 100 };
    }
    return { ...nextReport, assetStatus: "pending", assetProgress: 0 };
  };

  const startAssetExtraction = (id: string, sourceReport: ReportFile) => {
    if (
      sourceReport.kind !== "pdf" ||
      !sourceReport.sourceData ||
      sourceReport.assetStatus === "ready"
    )
      return;
    assetJobRef.current?.controller.abort();
    const controller = new AbortController();
    assetJobRef.current = { id, controller };
    setAssetProgress(0);
    setReport((current) =>
      current
        ? { ...current, assetStatus: "extracting", assetProgress: 0 }
        : current,
    );
    void extractPdfAssets(
      sourceReport.sourceData,
      (progress) => {
        if (assetJobRef.current?.id === id) setAssetProgress(progress);
      },
      controller.signal,
    )
      .then((assets) => {
        if (assetJobRef.current?.id !== id || controller.signal.aborted) return;
        setAssetProgress(100);
        setReport((current) => {
          if (!current) return current;
          const crops = current.assets.filter(
            (asset) => asset.source === "crop",
          );
          const selectedPages = new Set(
            current.assets
              .filter((asset) => asset.source === "page" && asset.selected)
              .map((asset) => asset.pageNumber),
          );
          return {
            ...current,
            assets: [
              ...assets.map((asset) => ({
                ...asset,
                selected: selectedPages.has(asset.pageNumber),
              })),
              ...crops,
            ],
            assetStatus: "ready",
            assetProgress: 100,
          };
        });
        assetJobRef.current = null;
        flash(`整页图片生成完成，共 ${assets.length} 页`);
      })
      .catch((error) => {
        if (controller.signal.aborted || assetJobRef.current?.id !== id) return;
        setReport((current) =>
          current
            ? { ...current, assetStatus: "error", assetProgress }
            : current,
        );
        assetJobRef.current = null;
        flash(
          error instanceof Error
            ? `图片提取失败：${error.message}`
            : "图片提取失败，可以使用手动裁切",
        );
      });
  };

  useEffect(() => {
    if (!showCropper || !report) return;
    const job = ++cropPreviewJobRef.current;
    setCompletedCrop(null);
    const existingPreview =
      report.pages.find((page) => page.pageNumber === cropPage)?.imageUrl || "";
    if (!report.sourceData) {
      setCropPreviewUrl(existingPreview);
      setIsCropPreviewLoading(false);
      return;
    }
    setCropPreviewUrl("");
    setIsCropPreviewLoading(true);
    void renderPdfPagePreview(report.sourceData, cropPage)
      .then((imageUrl) => {
        if (cropPreviewJobRef.current === job) setCropPreviewUrl(imageUrl);
      })
      .catch((error) => {
        if (cropPreviewJobRef.current === job)
          flash(error instanceof Error ? error.message : "页面预览生成失败");
      })
      .finally(() => {
        if (cropPreviewJobRef.current === job) setIsCropPreviewLoading(false);
      });
  }, [cropPage, projectId, showCropper]);

  useEffect(() => {
    if (step !== "copy") setShowCoverControls(false);
  }, [step]);

  const finalBody = useMemo(
    () => (report && draft ? finalizePostBody(draft.body, report) : ""),
    [draft, report],
  );
  const reportTitle = useMemo(
    () => report ? extractReportTitle(report.name) : "行业趋势报告",
    [report?.name],
  );
  const plainTextPost = useMemo(
    () => draft ? buildPlainTextPost(maskRestrictedBrands(draft.titles[draft.selectedTitle]), finalBody) : "",
    [draft, finalBody],
  );
  const postAnalysis = useMemo(() => analyzePostBody(finalBody), [finalBody]);
  const scheduleBounds = useMemo(() => ({
    min: toDateTimeLocalValue(new Date(Date.now() + 65 * 60 * 1000)),
    max: toDateTimeLocalValue(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)),
  }), []);
  const minimumContentLength = POST_MIN_LENGTH;
  const selectedAssets = report?.assets.filter((asset) => asset.selected) ?? [];
  const assetsBusy =
    report?.kind === "pdf" &&
    (report.assetStatus === "pending" || report.assetStatus === "extracting");
  const coverUrl = useMemo(
    () =>
      report && draft
        ? renderCover(
            reportTitle,
            report.pageCount,
            coverStyle,
            coverCustomization ?? defaultCoverCustomization(report),
          )
        : "",
    [coverCustomization, coverStyle, draft, fontRevision, report?.pageCount, reportTitle],
  );
  const coverEditUrl = useMemo(
    () => report && draft && showCoverControls
      ? renderCover(reportTitle, report.pageCount, coverStyle, coverCustomization ?? defaultCoverCustomization(report), true)
      : coverUrl,
    [coverCustomization, coverStyle, coverUrl, draft, report, reportTitle, showCoverControls],
  );
  const canFinish = Boolean(
    draft &&
      report &&
      postAnalysis.contentLength >= minimumContentLength &&
      postAnalysis.contentLength <= POST_MAX_LENGTH &&
      postAnalysis.tagCount === 10 &&
      postAnalysis.restrictedBrands.length === 0 &&
      selectedAssets.length <= MAX_SELECTED_REPORT_IMAGES &&
      (selectedAssets.length > 0 ||
        (report.kind === "docx" && report.assets.length === 0)),
  );
  const xhsDraftFingerprint = JSON.stringify({
    projectId,
    title: draft?.titles[draft.selectedTitle] ?? "",
    body: finalBody,
    assets: selectedAssets.map((asset) => asset.id),
    coverStyle,
    coverCustomization,
    scheduleAt: xhsPublishSettings.scheduleAt,
  });

  useEffect(() => {
    if (!xhsPrepared || !xhsPreparedFingerprint || xhsPreparedFingerprint === xhsDraftFingerprint) return;
    setXhsPrepared(null);
    setXhsPreparedFingerprint("");
    setXhsFinalConfirmed(false);
    setXhsProgress({ stage: "window_closed", message: "本地内容或定时时间已修改，请重新同步到小红书编辑页" });
  }, [xhsDraftFingerprint, xhsPrepared, xhsPreparedFingerprint]);

  const coverLayerLayout = (layer: CoverTextLayer) => {
    const titleLength = Array.from(coverCustomization?.title.replace(/\s+/g, "") ?? "").length;
    const likelyTwoTitleLines = titleLength > 11;
    const baseTop = layer === "source"
      ? coverStyle === "editorial" ? 18 : coverStyle === "data" ? 19.8 : 22.9
      : layer === "title"
        ? coverStyle === "editorial" ? 29 : coverStyle === "data" ? 37 : 34
        : coverStyle === "editorial"
          ? likelyTwoTitleLines ? 47 : 35
          : coverStyle === "data"
            ? likelyTwoTitleLines ? 53 : 43
            : likelyTwoTitleLines ? 52 : 41;
    const position = coverCustomization?.positions[layer] ?? { x: 0, y: 0 };
    const style: CSSProperties = {
      left: `${8.5 + position.x / 10.8}%`,
      top: `${baseTop + position.y / 14.4}%`,
    };
    if (layer === "source") {
      const label = `来源：${coverCustomization?.source.trim() || "报告来源"}`;
      const measuredTextWidth = Array.from(label).reduce(
        (width, character) => width + (/^[\u0000-\u00ff]$/.test(character) ? 12 : 22),
        0,
      );
      const canvasWidth = coverStyle === "data"
        ? Math.min(896, Math.max(160, measuredTextWidth + 48))
        : coverStyle === "signal"
          ? Math.min(896, Math.max(160, measuredTextWidth + 56))
          : Math.max(160, measuredTextWidth + 40);
      style.width = `${Math.min(82, canvasWidth / 10.8)}%`;
    }
    return style;
  };

  const refreshHistory = async () => {
    const [projects, projectGroups] = await Promise.all([listProjects(), listProjectGroups()]);
    setHistory(projects);
    setGroups(projectGroups);
  };
  const persist = async (nextStep?: Step, statusOverride = projectStatus) => {
    if (!projectId || !report || !draft) return;
    try {
      await saveProject({
        id: projectId,
        name: projectName || report.name,
        report,
        draft: { ...draft, body: finalBody },
        groupId: currentGroupId,
        coverStyle,
        coverCustomization: coverCustomization ?? defaultCoverCustomization(report),
        generationMode: preAIDraft ? "ai" : "local",
        preAIDraft: preAIDraft ?? undefined,
        xhsPublishSettings,
        step:
          nextStep && nextStep !== "upload"
            ? nextStep
            : step === "upload"
              ? "copy"
              : step,
        status: statusOverride,
        updatedAt: Date.now(),
      });
      await refreshHistory();
    } catch {
      flash("本机历史保存失败，但可以继续当前任务");
    } finally {
      if (nextStep) setStep(nextStep);
    }
  };

  useEffect(() => {
    if (!projectId || !report || !draft || step === "upload") return;
    const timer = window.setTimeout(() => {
      if (deletedProjectIdsRef.current.has(projectId)) return;
      void saveProject({
        id: projectId,
        name: projectName || report.name,
        report,
        draft: { ...draft, body: finalBody },
        groupId: currentGroupId,
        coverStyle,
        coverCustomization: coverCustomization ?? defaultCoverCustomization(report),
        generationMode: preAIDraft ? "ai" : "local",
        preAIDraft: preAIDraft ?? undefined,
        xhsPublishSettings,
        step,
        status: projectStatus,
        updatedAt: Date.now(),
      })
        .then(refreshHistory)
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [coverCustomization, coverStyle, currentGroupId, draft, finalBody, projectId, projectName, projectStatus, report, step, xhsPublishSettings]);

  const openProject = async (summary: ProjectSummary) => {
    setShowAISettings(false);
    setShowCoverControls(false);
    await persist();
    if (summary.id === projectId) {
      if (step === "upload" && report && draft)
        setStep(summary.step ?? "copy");
      setMobileHistoryOpen(false);
      return;
    }
    const project = await getProject(summary.id);
    if (!project) {
      flash("没有找到这条历史任务，请重新上传文档");
      return;
    }
    assetJobRef.current?.controller.abort();
    assetJobRef.current = null;
    const nextReport = normalizeAssetStatus(project.report);
    activeProjectIdRef.current = project.id;
    setProjectId(project.id);
    setProjectName(project.name || project.report.name);
    setPreAIDraft(project.generationMode === "ai" ? project.preAIDraft ?? null : null);
    setReport(nextReport);
    setActiveGroupId(project.groupId ?? DEFAULT_GROUP_ID);
    activeGroupIdRef.current = project.groupId ?? DEFAULT_GROUP_ID;
    setCurrentGroupId(project.groupId ?? DEFAULT_GROUP_ID);
    setExpandedGroupIds((current) => current.includes(project.groupId ?? DEFAULT_GROUP_ID) ? current : [...current, project.groupId ?? DEFAULT_GROUP_ID]);
    setAssetProgress(nextReport.assetProgress ?? 0);
    let nextDraft = project.draft;
    const shouldRefreshTitles = (project.status ?? "draft") !== "completed" && hasGenericReportTitles(project.draft.titles);
    const shouldRefreshNoisyBody = (project.status ?? "draft") !== "completed" && isLegacyNoisyGeneratedDraft(project.draft.body);
    if (shouldRefreshTitles || shouldRefreshNoisyBody) {
      try {
        const regenerated = buildDraft(nextReport);
        nextDraft = {
          ...project.draft,
          ...(shouldRefreshTitles
            ? {
                titles: regenerated.titles,
                selectedTitle: Math.min(project.draft.selectedTitle, regenerated.titles.length - 1),
              }
            : {}),
          ...(shouldRefreshNoisyBody
            ? {
                body: regenerated.body,
                tags: regenerated.tags,
                sources: regenerated.sources,
              }
            : {}),
        };
        await saveProject({
          ...project,
          report: nextReport,
          draft: nextDraft,
          updatedAt: Date.now(),
        });
        flash(shouldRefreshNoisyBody ? "已移除目录与章节噪声并重新整理正文" : "已按报告主标题更新文案标题");
      } catch {
        // 标题迁移不应影响用户继续编辑旧任务。
      }
    }
    nextDraft = {
      ...nextDraft,
      titles: nextDraft.titles.slice(0, 3),
      selectedTitle: Math.min(nextDraft.selectedTitle, 2),
    };
    setDraft(nextDraft);
    setCoverStyle(project.coverStyle);
    setCoverCustomization(normalizeCoverCustomization(nextReport, project.coverCustomization));
    setXhsPublishSettings(project.xhsPublishSettings ?? {
      scheduleAt: defaultScheduleValue(),
      groupStrategy: "smallest",
    });
    setXhsPrepared(null);
    setXhsPreparedFingerprint("");
    setXhsProgress(null);
    setXhsFinalConfirmed(false);
    setProjectStatus(project.status ?? "draft");
    setStep(project.step ?? "copy");
    setMobileHistoryOpen(false);
    startAssetExtraction(project.id, nextReport);
  };

  const startNew = async () => {
    setShowAISettings(false);
    setShowCoverControls(false);
    await persist();
    assetJobRef.current?.controller.abort();
    assetJobRef.current = null;
    activeProjectIdRef.current = null;
    setProjectId(null);
    setProjectName(null);
    setReport(null);
    setDraft(null);
    setPreAIDraft(null);
    setCoverCustomization(null);
    setXhsPublishSettings({ scheduleAt: defaultScheduleValue(), groupStrategy: "smallest" });
    setXhsPrepared(null);
    setXhsPreparedFingerprint("");
    setXhsProgress(null);
    setXhsFinalConfirmed(false);
    setProjectStatus("draft");
    setAssetProgress(0);
    setStep("upload");
    setMobileHistoryOpen(false);
  };

  const startNewInGroup = async (groupId: string) => {
    activeGroupIdRef.current = groupId;
    setActiveGroupId(groupId);
    setExpandedGroupIds((current) => current.includes(groupId) ? current : [...current, groupId]);
    await startNew();
    setCurrentGroupId(groupId);
  };

  const clearCurrentTask = (groupId: string) => {
    assetJobRef.current?.controller.abort();
    assetJobRef.current = null;
    activeProjectIdRef.current = null;
    setProjectId(null);
    setProjectName(null);
    setReport(null);
    setDraft(null);
    setPreAIDraft(null);
    setCoverCustomization(null);
    setXhsPublishSettings({ scheduleAt: defaultScheduleValue(), groupStrategy: "smallest" });
    setXhsPrepared(null);
    setXhsPreparedFingerprint("");
    setXhsProgress(null);
    setXhsFinalConfirmed(false);
    setShowCoverControls(false);
    setProjectStatus("draft");
    setAssetProgress(0);
    setActiveGroupId(groupId);
    activeGroupIdRef.current = groupId;
    setCurrentGroupId(groupId);
    setStep("upload");
    setMobileHistoryOpen(false);
  };

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    const now = Date.now();
    const group: ProjectGroup = { id: crypto.randomUUID(), name: name.slice(0, 24), createdAt: now, updatedAt: now };
    await saveProjectGroup(group);
    activeGroupIdRef.current = group.id;
    setActiveGroupId(group.id);
    setExpandedGroupIds((current) => [...current, group.id]);
    setNewGroupName("");
    setShowGroupCreator(false);
    await refreshHistory();
    flash(`已新建项目组「${group.name}」`);
  };

  const beginGroupRename = (group: ProjectGroup) => {
    setEditingTaskId(null);
    setEditingGroupId(group.id);
    setRenameValue(group.name);
  };

  const commitGroupRename = async (group: ProjectGroup, cancelled = false) => {
    setEditingGroupId(null);
    if (cancelled) return;
    const name = renameValue.trim().slice(0, 24);
    if (!name || name === group.name) return;
    try {
      await saveProjectGroup({ ...group, name, updatedAt: Date.now() });
      await refreshHistory();
      flash(`项目组已重命名为「${name}」`);
    } catch {
      flash("项目组重命名失败，请重试");
    }
  };

  const beginTaskRename = (project: ProjectSummary) => {
    setEditingGroupId(null);
    setEditingTaskId(project.id);
    setRenameValue(project.name.replace(/\.(pdf|docx)$/i, ""));
  };

  const commitTaskRename = async (project: ProjectSummary, cancelled = false) => {
    setEditingTaskId(null);
    if (cancelled) return;
    const name = renameValue.trim().slice(0, 40);
    const currentName = project.name.replace(/\.(pdf|docx)$/i, "");
    if (!name || name === currentName) return;
    try {
      await renameProject(project.id, name);
      if (project.id === projectId) setProjectName(name);
      await refreshHistory();
      flash(`任务已重命名为「${name}」`);
    } catch {
      flash("任务重命名失败，请重试");
    }
  };

  const removeGroup = async (group: ProjectGroup) => {
    if (group.id === DEFAULT_GROUP_ID) {
      flash("默认项目组不能删除，可以删除其中的内容任务");
      return;
    }
    const count = history.filter((project) => (project.groupId ?? DEFAULT_GROUP_ID) === group.id).length;
    if (!window.confirm(`删除项目组「${group.name}」${count ? `及其中 ${count} 条内容任务` : ""}？此操作无法撤销。`)) return;
    history
      .filter((project) => (project.groupId ?? DEFAULT_GROUP_ID) === group.id)
      .forEach((project) => deletedProjectIdsRef.current.add(project.id));
    await deleteProjectGroup(group.id);
    if (activeGroupId === group.id) {
      activeGroupIdRef.current = DEFAULT_GROUP_ID;
      setActiveGroupId(DEFAULT_GROUP_ID);
    }
    if (projectId && currentGroupId === group.id) {
      deletedProjectIdsRef.current.add(projectId);
      clearCurrentTask(DEFAULT_GROUP_ID);
    }
    await refreshHistory();
    flash("项目组已删除");
  };

  const removeTask = async (project: ProjectSummary) => {
    if (!window.confirm(`删除内容任务「${project.name.replace(/\.(pdf|docx)$/i, "")}」？此操作无法撤销。`)) return;
    deletedProjectIdsRef.current.add(project.id);
    await deleteProject(project.id);
    if (projectId === project.id) clearCurrentTask(project.groupId ?? DEFAULT_GROUP_ID);
    await refreshHistory();
    flash("内容任务已删除");
  };

  const beginCoverDrag = (layer: CoverTextLayer, event: React.PointerEvent<HTMLButtonElement>) => {
    if (!coverCustomization) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = coverCustomization.positions[layer];
    coverDragRef.current = { layer, startX: event.clientX, startY: event.clientY, originX: origin.x, originY: origin.y };
  };

  const nudgeCoverLayer = (layer: CoverTextLayer, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const direction = event.key === "ArrowLeft" ? [-1, 0] : event.key === "ArrowRight" ? [1, 0] : event.key === "ArrowUp" ? [0, -1] : event.key === "ArrowDown" ? [0, 1] : null;
    if (!direction) return;
    event.preventDefault();
    const distance = event.shiftKey ? 10 : 2;
    setCoverCustomization((current) => {
      if (!current) return current;
      const position = current.positions[layer];
      const maxX = layer === "source" ? 470 : 96;
      const maxY = layer === "source" ? 900 : 500;
      return {
        ...current,
        positions: {
          ...current.positions,
          [layer]: {
            x: Math.max(-72, Math.min(maxX, position.x + direction[0] * distance)),
            y: Math.max(-260, Math.min(maxY, position.y + direction[1] * distance)),
          },
        },
      };
    });
    setProjectStatus("draft");
  };

  const activeAIProviderId = inferAIProviderId(aiSettings.baseUrl);
  const activeAIProvider = AI_PROVIDER_PRESETS.find((provider) => provider.id === activeAIProviderId) ?? AI_PROVIDER_PRESETS.at(-1)!;
  const savedAIProviderId = inferAIProviderId(savedAIConnection.baseUrl);
  const savedAIProvider = AI_PROVIDER_PRESETS.find((provider) => provider.id === savedAIProviderId) ?? AI_PROVIDER_PRESETS.at(-1)!;
  const aiConnectionDirty = aiSettings.baseUrl.trim().replace(/\/+$/, "") !== savedAIConnection.baseUrl.trim().replace(/\/+$/, "")
    || aiSettings.model.trim() !== savedAIConnection.model.trim();
  const savedKeyMatchesEndpoint = aiSettings.hasApiKey
    && aiSettings.baseUrl.trim().replace(/\/+$/, "") === savedAIConnection.baseUrl.trim().replace(/\/+$/, "");
  const shouldUseAIKeyInput = !savedKeyMatchesEndpoint || isReplacingAIKey;
  const effectiveAIKeyInput = shouldUseAIKeyInput ? aiKeyInput.trim() : "";
  const aiGenerationMessage = aiGenerationPhase === "length-repair"
    ? aiLengthDirection === "short"
      ? `初稿长度不足，正在请 ${savedAIProvider.label} 补足内容`
      : `初稿篇幅偏长，正在请 ${savedAIProvider.label} 压缩重复表达`
    : aiGenerationSeconds < 4
      ? "正在准备安全请求"
      : aiGenerationSeconds < 60
        ? `正在等待 ${savedAIProvider.label} 返回完整文案`
        : "服务响应较慢，仍在等待模型返回";

  const selectAIProvider = (provider: AIProviderPreset) => {
    const keepCustomValues = provider.id === "custom" && activeAIProviderId === "custom";
    setAISettings({
      ...aiSettings,
      baseUrl: keepCustomValues ? aiSettings.baseUrl : provider.baseUrl,
      model: keepCustomValues ? aiSettings.model : provider.model,
    });
    if (provider.id !== activeAIProviderId) setAIKeyInput("");
    if (provider.id !== activeAIProviderId) setIsReplacingAIKey(false);
    setAITestResult(null);
    setTestedAIConnection(null);
  };

  const saveAIConfiguration = async () => {
    if (!window.reportAgentAI) {
      flash("AI 接入仅在桌面 App 中可用");
      return;
    }
    if (!aiSettings.baseUrl.trim() || !aiSettings.model.trim()) {
      flash("请填写接口地址和模型名称");
      return;
    }
    const signature = `${aiSettings.baseUrl.trim().replace(/\/+$/, "")}\u0000${aiSettings.model.trim()}\u0000${effectiveAIKeyInput}`;
    const connectionChanged = Boolean(effectiveAIKeyInput)
      || aiSettings.baseUrl.trim().replace(/\/+$/, "") !== savedAIConnection.baseUrl.trim().replace(/\/+$/, "")
      || aiSettings.model.trim() !== savedAIConnection.model.trim();
    if (connectionChanged && testedAIConnection !== signature) {
      setAITestResult({ status: "error", message: "连接信息已变更，请先通过真实连接测试再保存" });
      return;
    }
    setIsSavingAISettings(true);
    try {
      const saved = await window.reportAgentAI.saveSettings({
        baseUrl: aiSettings.baseUrl,
        model: aiSettings.model,
        systemPrompt: aiSettings.systemPrompt,
        apiKey: effectiveAIKeyInput || undefined,
      });
      setAISettings(saved);
      setSavedAIConnection({ baseUrl: saved.baseUrl, model: saved.model });
      setAIKeyInput("");
      setIsReplacingAIKey(false);
      flash("AI 接入设置已保存在本机");
    } catch (error) {
      flash(desktopErrorMessage(error, "AI 设置保存失败"));
    } finally {
      setIsSavingAISettings(false);
    }
  };

  const testAIConfiguration = async () => {
    if (!window.reportAgentAI) {
      setAITestResult({ status: "error", message: "连接测试仅在桌面 App 中可用" });
      return;
    }
    if (!aiSettings.baseUrl.trim() || !aiSettings.model.trim()) {
      setAITestResult({ status: "error", message: "请先填写接口地址和模型名称" });
      return;
    }
    setIsTestingAISettings(true);
    setAITestResult(null);
    try {
      const result = await window.reportAgentAI.testConnection({
        baseUrl: aiSettings.baseUrl,
        model: aiSettings.model,
        apiKey: effectiveAIKeyInput || undefined,
      });
      setTestedAIConnection(`${aiSettings.baseUrl.trim().replace(/\/+$/, "")}\u0000${aiSettings.model.trim()}\u0000${effectiveAIKeyInput}`);
      setAITestResult({ status: "success", message: `连接成功 · ${result.model} · ${result.latencyMs} ms · 返回「${result.reply}」` });
    } catch (error) {
      setAITestResult({ status: "error", message: desktopErrorMessage(error, "连接测试失败") });
    } finally {
      setIsTestingAISettings(false);
    }
  };

  const clearAIKey = async () => {
    if (!window.reportAgentAI) return;
    if (!window.confirm(`清除 ${savedAIProvider.label} 已保存在本机的 API Key？清除后无法恢复，需要重新填写。`)) return;
    try {
      const saved = await window.reportAgentAI.clearKey();
      setAISettings(saved);
      setSavedAIConnection({ baseUrl: saved.baseUrl, model: saved.model });
      setAIKeyInput("");
      setIsReplacingAIKey(false);
      setTestedAIConnection(null);
      flash("已清除本机 API Key");
    } catch (error) {
      flash(error instanceof Error ? error.message : "API Key 清除失败");
    }
  };

  const generateWithAI = async () => {
    if (!report || !draft) return;
    if (!window.reportAgentAI || !aiSettings.hasApiKey || aiConnectionDirty) {
      setShowAISettings(true);
      flash(aiConnectionDirty ? "服务商或模型尚未保存，请测试并保存后再生成" : "请先完成 AI 接入设置");
      return;
    }
    const requestId = ++aiRequestRef.current;
    const sourceProjectId = projectId;
    const sourceDraft = draft;
    const customSystemPrompt = aiSettings.systemPrompt.trim();
    const effectiveSystemPrompt = customSystemPrompt
      ? `${customSystemPrompt}\n\n${REQUIRED_AI_COPY_RULES}`
      : DEFAULT_SYSTEM_PROMPT;
    setAIGenerationPhase("draft");
    setIsGeneratingAI(true);
    try {
      const evidence = draft.sources.map((source) => source.quote).join("\n");
      const reportContext = `报告文件名：${report.name}\n报告原标题：${reportTitle}\n\n当前规则版标题：\n${draft.titles.join("\n")}\n\n当前规则版正文：\n${finalBody}\n\n优先事实：\n${evidence}\n\n报告解析文本：\n${report.extractedText.slice(0, 28_000)}`;
      let raw = await window.reportAgentAI.generateCopy({
        systemPrompt: effectiveSystemPrompt,
        userPrompt: `${reportContext}\n\n请在不改变事实的前提下重写。用 1–2 句引子建立阅读价值，各信息模块以 emoji + 【关键词】分段并保留空行，结尾用客观的趋势信号总结；正文优先写到 ${AI_TARGET_MIN_LENGTH}–${AI_TARGET_MAX_LENGTH} 个非空白字符。`,
      });
      if (aiRequestRef.current !== requestId || activeProjectIdRef.current !== sourceProjectId || draftRef.current !== sourceDraft) {
        throw new Error("AI 生成期间当前任务或文案已发生变化，本次结果未覆盖现有内容");
      }
      let generated = parseAICopyResponse(raw);
      generated = { ...generated, body: sanitizeAICopyBody(generated.body) };
      let aiCoreBody = generated.body;
      let generatedBody = finalizePostBody(generated.body, report);
      let analysis = analyzePostBody(generatedBody);
      if (analysis.contentLength < POST_MIN_LENGTH || analysis.contentLength > POST_MAX_LENGTH) {
        setAILengthDirection(analysis.contentLength < POST_MIN_LENGTH ? "short" : "long");
        setAIGenerationPhase("length-repair");
        raw = await window.reportAgentAI.generateCopy({
          systemPrompt: `${effectiveSystemPrompt}\n\n本轮是长度校准：必须保留原稿事实，只调整信息密度，使正文优先达到 ${AI_TARGET_MIN_LENGTH}–${AI_TARGET_MAX_LENGTH} 个非空白字符。保留引子、emoji 模块标题、模块间空行和客观趋势结尾，不得把正文压成连续长段落。`,
          userPrompt: `${reportContext}\n\n上一版 AI 正文有 ${analysis.contentLength} 个非空白字符：\n${generated.body}\n\n${analysis.contentLength < POST_MIN_LENGTH ? `请补充约 ${Math.max(0, AI_TARGET_LENGTH - analysis.contentLength)} 字` : "请删减重复表达"}，优先补充报告中已有的人群、场景、品类、渠道和趋势；禁止新增报告里没有的数字。每个模块仍需单独成段，结尾不要写“我的判断”。仍然只返回严格 JSON。`,
        });
        if (aiRequestRef.current !== requestId || activeProjectIdRef.current !== sourceProjectId || draftRef.current !== sourceDraft) {
          throw new Error("AI 校准期间当前任务或文案已发生变化，本次结果未覆盖现有内容");
        }
        generated = parseAICopyResponse(raw);
        generated = { ...generated, body: sanitizeAICopyBody(generated.body) };
        aiCoreBody = generated.body;
        generatedBody = finalizePostBody(generated.body, report);
        analysis = analyzePostBody(generatedBody);
        if (analysis.contentLength < POST_MIN_LENGTH || analysis.contentLength > POST_MAX_LENGTH) {
          generated = { ...generated, body: sanitizeAICopyBody(fitAICopyToRequiredLength(generated.body, finalBody)) };
          generatedBody = finalizePostBody(generated.body, report);
          analysis = analyzePostBody(generatedBody);
        }
      }
      const groundedText = `${report.name}\n${reportTitle}\n${report.extractedText}\n${evidence}\n${finalBody}`;
      const groundedNumbers = new Set(extractMaterialNumbers(groundedText));
      aiCoreBody = sanitizeAICopyBody(removeUngroundedNumberLines(aiCoreBody, groundedNumbers));
      aiCoreBody = dedupeCopySentences(aiCoreBody) || aiCoreBody;
      if (compactCharacterCount(aiCoreBody) < 120) throw new Error("AI 返回的有效报告内容不足 120 字，未覆盖原稿；请重试或更换模型");
      generated = { ...generated, body: sanitizeAICopyBody(fitAICopyToRequiredLength(aiCoreBody, finalBody)) };
      generatedBody = finalizePostBody(generated.body, report);
      analysis = analyzePostBody(generatedBody);
      if (analysis.contentLength < POST_MIN_LENGTH || analysis.contentLength > POST_MAX_LENGTH) {
        throw new Error(`AI 正文经过自动清洗和校准后仍为 ${analysis.contentLength} 字，原文已保留。建议换用能力更强的模型后重试。`);
      }
      if (analysis.tagCount !== 10) throw new Error("AI 文案的话题标签处理异常，请重试");
      if (hasDisallowedAICopyArtifacts(generated.body)) throw new Error("AI 文案自动清洗未完成，原文已保留，请重试");
      const remainingInventedNumbers = [...new Set(extractMaterialNumbers(generated.body))].filter((number) => !groundedNumbers.has(number));
      if (remainingInventedNumbers.length) throw new Error(`AI 文案仍包含报告中未找到的数据：${remainingInventedNumbers.join("、")}，原文已保留`);
      if (stripPostTags(generatedBody).replace(/\s/g, "") === stripPostTags(finalBody).replace(/\s/g, "")) {
        throw new Error("AI 返回内容与原稿没有实质差异，本次未覆盖；请重试或更换模型");
      }
      const recency = extractReportRecency(`${report.name}\n${report.pages[0]?.text.slice(0, 800) ?? ""}`);
      const generatedTitles = generated.titles.map((title, index) => fitGeneratedTitle(
        extractMaterialNumbers(title).every((number) => groundedNumbers.has(number))
          ? applyRecencyToTitle(maskRestrictedBrands(title.trim()), recency)
          : maskRestrictedBrands(draft.titles[index] ?? draft.titles[0]),
        draft.titles[index] ?? draft.titles[0],
      ));
      while (generatedTitles.length < 3) generatedTitles.push(draft.titles[generatedTitles.length] ?? draft.titles[0]);
      setPreAIDraft((current) => current ?? sourceDraft);
      setDraft({ ...draft, titles: generatedTitles.slice(0, 3), selectedTitle: 0, body: generatedBody });
      setProjectStatus("draft");
      flash("AI 文案已生成，请核对事实后再发布");
    } catch (error) {
      flash(desktopErrorMessage(error, "AI 文案生成失败"));
    } finally {
      setIsGeneratingAI(false);
      setAIGenerationPhase("draft");
    }
  };

  const goBack = async () => {
    if (step === "copy") {
      await persist();
      setStep("upload");
      return;
    }
    setProjectStatus("draft");
    await persist(step === "images" ? "copy" : "images", "draft");
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    assetJobRef.current?.controller.abort();
    assetJobRef.current = null;
    activeProjectIdRef.current = null;
    setIsParsing(true);
    setParseProgress(2);
    setParseMessage("正在打开文档");
    try {
      const parsedReport = await parseDocument(file, (progress, message) => {
        setParseProgress(progress);
        setParseMessage(message);
      });
      const nextReport = normalizeAssetStatus(parsedReport);
      const nextDraft = buildDraft(nextReport);
      const id = crypto.randomUUID();
      activeProjectIdRef.current = id;
      setProjectId(id);
      setProjectName(nextReport.name);
      setPreAIDraft(null);
      setXhsPublishSettings({ scheduleAt: defaultScheduleValue(), groupStrategy: "smallest" });
      setXhsPrepared(null);
      setXhsPreparedFingerprint("");
      setXhsProgress(null);
      setXhsFinalConfirmed(false);
      setReport(nextReport);
      setCurrentGroupId(activeGroupIdRef.current);
      setAssetProgress(nextReport.assetProgress ?? 0);
      setDraft(nextDraft);
      setCoverStyle("signal");
      setShowCoverControls(false);
      const nextCoverCustomization = defaultCoverCustomization(nextReport);
      setCoverCustomization(nextCoverCustomization);
      setProjectStatus("draft");
      setStep("copy");
      flash(
        nextReport.kind === "pdf"
          ? "文字解析完成，可以先编辑文案"
          : `解析完成，找到 ${nextReport.assets.length} 张文档图片`,
      );
      void saveProject({
        id,
        name: nextReport.name,
        report: nextReport,
        draft: nextDraft,
        groupId: activeGroupIdRef.current,
        coverStyle: "signal",
        coverCustomization: nextCoverCustomization,
        generationMode: "local",
        xhsPublishSettings: {
          scheduleAt: defaultScheduleValue(),
          groupStrategy: "smallest",
        },
        step: "copy",
        status: "draft",
        updatedAt: Date.now(),
      })
        .then(refreshHistory)
        .catch(() => flash("文档已解析，但本机历史保存失败"));
      startAssetExtraction(id, nextReport);
    } catch (error) {
      flash(error instanceof Error ? error.message : "文档解析失败");
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const toggleAsset = (assetId: string) => {
    if (!report) return;
    const target = report.assets.find((asset) => asset.id === assetId);
    if (target && !target.selected && selectedAssets.length >= MAX_SELECTED_REPORT_IMAGES) {
      flash(`最多选择 ${MAX_SELECTED_REPORT_IMAGES} 张图片`);
      return;
    }
    setReport((current) =>
      current
        ? {
            ...current,
            assets: current.assets.map((asset) =>
              asset.id === assetId
                ? { ...asset, selected: !asset.selected }
                : asset,
            ),
          }
        : current,
    );
    setProjectStatus("draft");
  };

  const addCrop = async () => {
    if (!report || !completedCrop || !cropImageRef.current) return;
    if (selectedAssets.length >= MAX_SELECTED_REPORT_IMAGES) {
      flash(`最多选择 ${MAX_SELECTED_REPORT_IMAGES} 张图片`);
      return;
    }
    const image = cropImageRef.current;
    const sourceProjectId = projectId;
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    setIsCropping(true);
    try {
      const bounds = {
        x: completedCrop.x / image.width,
        y: completedCrop.y / image.height,
        width: completedCrop.width / image.width,
        height: completedCrop.height / image.height,
      };
      let cropped: { imageUrl: string; width: number; height: number };
      if (report.sourceData) {
        cropped = await renderPdfCrop(report.sourceData, cropPage, bounds);
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(completedCrop.width * scaleX));
        canvas.height = Math.max(1, Math.round(completedCrop.height * scaleY));
        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(
          image,
          completedCrop.x * scaleX,
          completedCrop.y * scaleY,
          completedCrop.width * scaleX,
          completedCrop.height * scaleY,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        cropped = {
          imageUrl: canvas.toDataURL("image/png"),
          width: canvas.width,
          height: canvas.height,
        };
      }
      const asset: ReportAsset = {
        id: `crop-${Date.now()}`,
        pageNumber: cropPage,
        ...cropped,
        selected: true,
        source: "crop",
      };
      if (activeProjectIdRef.current !== sourceProjectId) return;
      setReport((current) =>
        current ? { ...current, assets: [...current.assets, asset] } : current,
      );
      setProjectStatus("draft");
      setShowCropper(false);
      flash(`已加入第 ${cropPage} 页高清裁切图`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "裁切失败");
    } finally {
      setIsCropping(false);
    }
  };

  const openXhsLogin = async () => {
    if (!window.reportAgentXhs) {
      flash("小红书同步仅在桌面 App 中可用");
      return;
    }
    try {
      setXhsProgress({ stage: "awaiting_login", message: "正在打开小红书官方登录页" });
      const status = await window.reportAgentXhs.openLogin();
      setXhsConnection(status);
      flash(status.connected ? "小红书账号已连接" : "请在打开的小红书窗口扫码登录");
    } catch (error) {
      flash(error instanceof Error ? error.message : "无法打开小红书登录页");
    }
  };

  const disconnectXhs = async () => {
    if (!window.reportAgentXhs) return;
    if (!window.confirm("退出后会清除研报笔记专用浏览器中的小红书登录状态，确定继续吗？")) return;
    try {
      const status = await window.reportAgentXhs.disconnect();
      setXhsConnection(status);
      setXhsPrepared(null);
      setXhsPreparedFingerprint("");
      setXhsProgress(null);
      setXhsFinalConfirmed(false);
      flash("小红书登录状态已从本机清除");
    } catch (error) {
      flash(error instanceof Error ? error.message : "清除登录状态失败");
    }
  };

  const prepareXhsPublish = async () => {
    if (!window.reportAgentXhs || !report || !draft || !projectId) {
      flash("小红书同步仅在桌面 App 中可用");
      return;
    }
    if (!canFinish) {
      flash("请先完成标题、正文、标签和报告图片审核");
      return;
    }
    if (!isValidScheduleValue(xhsPublishSettings.scheduleAt)) {
      flash("定时发布时间必须在当前时间 1 小时至 14 天内");
      return;
    }
    const tags = [...new Set((finalBody.match(/#[^\s#]+/g) ?? []).map((tag) => tag.slice(1)))];
    if (tags.length !== 10) {
      flash("同步前需要确认正好 10 个标签");
      return;
    }
    setIsXhsSyncing(true);
    setXhsPrepared(null);
    setXhsPreparedFingerprint("");
    setXhsFinalConfirmed(false);
    setXhsProgress({ stage: "preparing", message: "正在整理发布素材" });
    try {
      const result = await window.reportAgentXhs.preparePublish({
        projectId,
        title: maskRestrictedBrands(draft.titles[draft.selectedTitle]),
        content: stripPostTags(finalBody),
        tags,
        images: [coverUrl, ...selectedAssets.map((asset) => asset.imageUrl)],
        scheduleAt: beijingScheduleToIso(xhsPublishSettings.scheduleAt),
        groupStrategy: "smallest",
      });
      setXhsPrepared(result);
      setXhsPreparedFingerprint(xhsDraftFingerprint);
      setXhsConnection((current) => ({
        ...current,
        connected: true,
        accountName: result.accountName || current.accountName,
      }));
      flash(`已同步到小红书，并选择 ${result.group.name}（${result.group.count} 人）`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "同步到小红书失败，未执行发布");
    } finally {
      setIsXhsSyncing(false);
    }
  };

  const recordPublishedReceipt = async (receipt: NonNullable<XhsConnectionStatus["pendingReceipt"]>) => {
    const isCurrentProject = receipt.projectId === projectId && report && draft;
    if (isCurrentProject) {
      await saveProject({
        id: projectId,
        name: projectName || report.name,
        report,
        draft: { ...draft, body: finalBody },
        groupId: currentGroupId,
        coverStyle,
        coverCustomization: coverCustomization ?? defaultCoverCustomization(report),
        generationMode: preAIDraft ? "ai" : "local",
        preAIDraft: preAIDraft ?? undefined,
        xhsPublishSettings,
        step: "review",
        status: "completed",
        updatedAt: Date.now(),
      });
      setProjectStatus("completed");
    } else {
      const stored = await getProject(receipt.projectId);
      if (!stored) throw new Error("找不到这次发布对应的本地任务，防重复锁已保留");
      await saveProject({ ...stored, step: "review", status: "completed", updatedAt: Date.now() });
    }
    await refreshHistory();
  };

  const submitXhsScheduled = async () => {
    if (!window.reportAgentXhs || !xhsPrepared || !xhsFinalConfirmed || isXhsSubmitting) return;
    setIsXhsSubmitting(true);
    try {
      const result = await window.reportAgentXhs.submitScheduled({
        attemptId: xhsPrepared.attemptId,
        confirmation: "CONFIRM_SCHEDULE_PUBLISH",
      });
      const status = await window.reportAgentXhs.getStatus();
      if (result.confirmed) {
        if (!status.pendingReceipt) throw new Error("小红书已返回成功，但本地发布记录缺失，已停止后续操作");
        await recordPublishedReceipt(status.pendingReceipt);
        const acknowledged = await window.reportAgentXhs.resolvePending("published");
        setXhsConnection(acknowledged);
        flash("小红书已确认定时发布成功");
      } else {
        setXhsConnection(status);
        flash("已经点击定时发布，但结果状态不明确，请在小红书页面确认；系统不会自动重试");
      }
      setXhsPrepared(null);
      setXhsPreparedFingerprint("");
      setXhsFinalConfirmed(false);
    } catch (error) {
      flash(error instanceof Error ? error.message : "定时发布失败，系统没有重试");
    } finally {
      setIsXhsSubmitting(false);
    }
  };

  const resolveXhsPending = async (resolution: "published" | "not_published") => {
    if (!window.reportAgentXhs || !xhsConnection.pendingReceipt) return;
    const receipt = xhsConnection.pendingReceipt;
    const action = resolution === "published" ? "确认已经发布" : "确认没有发布";
    if (!window.confirm(`${action}？请先在小红书官方页面核对。此操作会解除防重复发布锁。`)) return;
    try {
      if (resolution === "published") await recordPublishedReceipt(receipt);
      const status = await window.reportAgentXhs.resolvePending(resolution);
      setXhsConnection(status);
      setXhsProgress({
        stage: resolution === "published" ? "submitted" : "failed",
        message: resolution === "published" ? "已人工确认定时发布成功" : "已人工确认没有发布，可以重新同步",
      });
      flash(resolution === "published" ? "已记录为发布成功" : "防重复锁已解除，可以重新同步");
    } catch (error) {
      flash(error instanceof Error ? error.message : "处理待确认发布状态失败");
    }
  };

  const copyPost = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(plainTextPost);
      flash("纯文本文案已复制，可以直接粘贴");
    } catch {
      flash("复制失败，请手动选择正文");
    }
  };

  const exportPackage = async () => {
    if (!report || !draft || !canFinish || isExporting) return;
    setIsExporting(true);
    try {
      const zip = new JSZip();
      zip.file("01-封面.png", dataUrlToBlob(coverUrl));
      for (let index = 0; index < selectedAssets.length; index += 1) {
        const asset = selectedAssets[index];
        const sourceLabel =
          asset.pageNumber > 0 ? `P${asset.pageNumber}` : "Word";
        zip.file(
          `02-报告图片-${String(index + 1).padStart(2, "0")}-${sourceLabel}.jpg`,
          await imageToExportBlob(asset.imageUrl),
        );
      }
      zip.file(
        "03-发布文案.txt",
        `\uFEFF${plainTextPost}`,
      );
      const imageOrder = [
        `报告：${maskRestrictedBrands(reportTitle)}`,
        "",
        "图片顺序",
        "01 封面",
        ...selectedAssets.map((asset, index) =>
          `${String(index + 2).padStart(2, "0")} 报告图片${asset.pageNumber > 0 ? `（原报告第 ${asset.pageNumber} 页）` : "（Word 原图）"}`,
        ),
      ].join("\n");
      zip.file("04-图片顺序.txt", `\uFEFF${imageOrder}\n`);
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "STORE",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${safeFileName(draft.titles[draft.selectedTitle])}-小红书内容包.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setProjectStatus("completed");
      await saveProject({
        id: projectId!,
        name: projectName || report.name,
        report,
        draft: { ...draft, body: finalBody },
        groupId: currentGroupId,
        coverStyle,
        coverCustomization: coverCustomization ?? defaultCoverCustomization(report),
        generationMode: preAIDraft ? "ai" : "local",
        preAIDraft: preAIDraft ?? undefined,
        xhsPublishSettings,
        step: "review",
        status: "completed",
        updatedAt: Date.now(),
      });
      await refreshHistory();
      flash("内容包已导出");
    } catch (error) {
      flash(error instanceof Error ? error.message : "导出失败，请重试");
    } finally {
      setIsExporting(false);
    }
  };

  const currentStepIndex = steps.findIndex((item) => item.id === step);
  const displayedGroups = groups.length ? groups : [{
    id: DEFAULT_GROUP_ID,
    name: "默认项目组",
    createdAt: 0,
    updatedAt: 0,
  }];

  return (
    <div
      className={`wizard-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <aside className="history-sidebar">
        <div className="wizard-brand">
          <div className="wizard-brand-mark">研</div>
          <div className="brand-copy">
            <strong>报告观察家</strong>
            <span>行业内容工作台</span>
          </div>
          <button
            className="collapse-button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? "展开创作台" : "收起创作台"}
          >
            {sidebarCollapsed ? <CaretRight /> : <CaretLeft />}
          </button>
        </div>
        <button
          className="sidebar-new"
          aria-label="新建内容"
          onClick={() => void startNew()}
        >
          <Plus weight="bold" />
          <span>新建内容</span>
        </button>
        <button
          className={`sidebar-home ${step === "upload" ? "active" : ""}`}
          aria-label="上传首页"
          onClick={() => void startNew()}
        >
          <House />
          <span>上传首页</span>
        </button>
        <button
          type="button"
          className={`sidebar-ai-settings ${showAISettings ? "active" : ""}`}
          onClick={() => { setShowAISettings(true); setMobileHistoryOpen(false); }}
          aria-label="AI 接入设置"
        >
          <GearSix />
          <span>AI 接入设置</span>
          {!sidebarCollapsed && <i className={aiSettings.hasApiKey && !aiConnectionDirty ? "connected" : ""} />}
        </button>
        <button
          className="mobile-history-toggle"
          aria-label="查看历史任务"
          onClick={() => setMobileHistoryOpen(!mobileHistoryOpen)}
        >
          <ClockCounterClockwise />
          <span>历史</span>
        </button>
        <div className="history-title">
          <span>项目与任务</span>
          <button
            type="button"
            aria-label="新建项目组"
            onClick={() => setShowGroupCreator((value) => !value)}
          >
            <Plus weight="bold" />
          </button>
        </div>
        {showGroupCreator && !sidebarCollapsed && (
          <div className="group-creator">
            <input
              autoFocus
              value={newGroupName}
              maxLength={24}
              placeholder="项目组名称"
              onChange={(event) => setNewGroupName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createGroup();
                if (event.key === "Escape") setShowGroupCreator(false);
              }}
            />
            <button type="button" onClick={() => void createGroup()}><Check /></button>
          </div>
        )}
        <div className="history-list">
          {displayedGroups.map((group) => {
            const expanded = expandedGroupIds.includes(group.id);
            const tasks = history.filter((project) => (project.groupId ?? DEFAULT_GROUP_ID) === group.id);
            return (
              <section className="project-group" key={group.id}>
                <div className={`project-group-row ${activeGroupId === group.id ? "active" : ""} ${group.id !== DEFAULT_GROUP_ID ? "deletable" : ""}`}>
                  {editingGroupId === group.id ? (
                    <div className="group-toggle group-rename">
                      {expanded ? <CaretDown /> : <CaretRight />}
                      {expanded ? <FolderOpen weight="fill" /> : <Folder weight="fill" />}
                      <input
                        autoFocus
                        value={renameValue}
                        maxLength={24}
                        aria-label={`重命名项目组 ${group.name}`}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={(event) => void commitGroupRename(group, event.currentTarget.dataset.cancel === "true")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") { event.currentTarget.dataset.cancel = "true"; event.currentTarget.blur(); }
                        }}
                      />
                      <small>{tasks.length}</small>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="group-toggle"
                      title="双击重命名"
                      onDoubleClick={(event) => { event.preventDefault(); beginGroupRename(group); }}
                      onClick={() => {
                        activeGroupIdRef.current = group.id;
                        setActiveGroupId(group.id);
                        setExpandedGroupIds((current) => current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id]);
                      }}
                    >
                      {expanded ? <CaretDown /> : <CaretRight />}
                      {expanded ? <FolderOpen weight="fill" /> : <Folder weight="fill" />}
                      <span>{group.name}</span>
                      <small>{tasks.length}</small>
                    </button>
                  )}
                  <button type="button" className="group-add" aria-label={`在${group.name}中新建内容`} onClick={() => void startNewInGroup(group.id)}><Plus /></button>
                  {group.id !== DEFAULT_GROUP_ID && <button type="button" className="group-delete" aria-label={`删除${group.name}`} onClick={() => void removeGroup(group)}><Trash /></button>}
                </div>
                {expanded && (
                  <div className="group-tasks">
                    {tasks.map((project) => (
                      <div className={`history-task ${projectId === project.id ? "active" : ""}`} key={project.id}>
                        {editingTaskId === project.id ? (
                          <div className="task-rename-row">
                            {project.kind === "pdf" ? <FilePdf weight="fill" /> : <FileDoc weight="fill" />}
                            <input
                              autoFocus
                              value={renameValue}
                              maxLength={40}
                              aria-label={`重命名任务 ${project.name.replace(/\.(pdf|docx)$/i, "")}`}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onBlur={(event) => void commitTaskRename(project, event.currentTarget.dataset.cancel === "true")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                                if (event.key === "Escape") { event.currentTarget.dataset.cancel = "true"; event.currentTarget.blur(); }
                              }}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            title="双击重命名"
                            onClick={() => {
                              if (pendingTaskOpenRef.current) window.clearTimeout(pendingTaskOpenRef.current);
                              pendingTaskOpenRef.current = window.setTimeout(() => {
                                pendingTaskOpenRef.current = null;
                                void openProject(project);
                              }, 220);
                            }}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (pendingTaskOpenRef.current) window.clearTimeout(pendingTaskOpenRef.current);
                              pendingTaskOpenRef.current = null;
                              beginTaskRename(project);
                            }}
                          >
                            {project.kind === "pdf" ? <FilePdf weight="fill" /> : <FileDoc weight="fill" />}
                            <span>
                              <strong>{project.name.replace(/\.(pdf|docx)$/i, "")}</strong>
                              <small>{project.status === "completed" ? "已完成" : project.step === "review" ? "待审核" : project.step === "images" ? "待选图" : "编辑中"} · {new Date(project.updatedAt).toLocaleDateString("zh-CN")}</small>
                            </span>
                          </button>
                        )}
                        <button type="button" className="task-delete" aria-label={`删除${project.name}`} onClick={() => void removeTask(project)}><Trash /></button>
                      </div>
                    ))}
                    {!tasks.length && group.id !== DEFAULT_GROUP_ID && <button type="button" className="empty-group-task" onClick={() => void startNewInGroup(group.id)}>上传第一份报告</button>}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div className="sidebar-foot">
          <ClockCounterClockwise />
          <span>任务自动保存在本机</span>
        </div>
        {mobileHistoryOpen && (
          <div className="mobile-history-drawer">
            <div>
              <strong>项目与任务</strong>
              <button aria-label="新建项目组" onClick={() => setShowGroupCreator((value) => !value)}><Plus /></button>
              <button aria-label="AI 接入设置" onClick={() => { setMobileHistoryOpen(false); setShowAISettings(true); }}><GearSix /></button>
              <button
                aria-label="关闭历史任务"
                onClick={() => setMobileHistoryOpen(false)}
              >
                <X />
              </button>
            </div>
            {showGroupCreator && (
              <div className="mobile-group-creator">
                <input value={newGroupName} placeholder="项目组名称" maxLength={24} onChange={(event) => setNewGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createGroup(); }} />
                <button onClick={() => void createGroup()}><Check /></button>
              </div>
            )}
            {displayedGroups.map((group) => {
              const tasks = history.filter((project) => (project.groupId ?? DEFAULT_GROUP_ID) === group.id);
              return (
                <section className="mobile-project-group" key={group.id}>
                  <div className={group.id !== DEFAULT_GROUP_ID ? "deletable" : ""}>
                    <FolderOpen weight="fill" />
                    {editingGroupId === group.id ? (
                      <input
                        autoFocus
                        className="mobile-rename-input"
                        aria-label={`重命名项目组 ${group.name}`}
                        value={renameValue}
                        maxLength={24}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={(event) => void commitGroupRename(group, event.currentTarget.dataset.cancel === "true")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") { event.currentTarget.dataset.cancel = "true"; event.currentTarget.blur(); }
                        }}
                      />
                    ) : <strong title="双击重命名" onDoubleClick={() => beginGroupRename(group)}>{group.name}</strong>}
                    <button aria-label={`在${group.name}中新建内容`} onClick={() => void startNewInGroup(group.id)}><Plus /></button>
                    {group.id !== DEFAULT_GROUP_ID && <button aria-label={`删除${group.name}`} onClick={() => void removeGroup(group)}><Trash /></button>}
                  </div>
                  {tasks.map((project) => (
                    <div className="mobile-task-row" key={project.id}>
                      {editingTaskId === project.id ? (
                        <div className="mobile-task-edit">
                          {project.kind === "pdf" ? <FilePdf /> : <FileDoc />}
                          <input
                            autoFocus
                            className="mobile-rename-input"
                            aria-label={`重命名任务 ${project.name.replace(/\.(pdf|docx)$/i, "")}`}
                            value={renameValue}
                            maxLength={40}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onBlur={(event) => void commitTaskRename(project, event.currentTarget.dataset.cancel === "true")}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                              if (event.key === "Escape") { event.currentTarget.dataset.cancel = "true"; event.currentTarget.blur(); }
                            }}
                          />
                        </div>
                      ) : (
                        <button
                          title="双击重命名"
                          onClick={() => {
                            if (pendingTaskOpenRef.current) window.clearTimeout(pendingTaskOpenRef.current);
                            pendingTaskOpenRef.current = window.setTimeout(() => {
                              pendingTaskOpenRef.current = null;
                              void openProject(project);
                            }, 220);
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            if (pendingTaskOpenRef.current) window.clearTimeout(pendingTaskOpenRef.current);
                            pendingTaskOpenRef.current = null;
                            beginTaskRename(project);
                          }}
                        >{project.kind === "pdf" ? <FilePdf /> : <FileDoc />}<span>{project.name.replace(/\.(pdf|docx)$/i, "")}</span></button>
                      )}
                      <button aria-label={`删除${project.name}`} onClick={() => void removeTask(project)}><Trash /></button>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </aside>

      <main className="wizard-main">
        {xhsConnection.pendingReceipt && (
          <div className="xhs-global-pending" role="alert">
            <ShieldCheck weight="fill" />
            <span>
              <strong>
                {xhsConnection.pendingReceipt.status === "confirmed_published"
                  ? "平台已确认发布，本地记录待完成"
                  : "上一次发布结果待确认，已锁定重复发布"}
              </strong>
              <small>@{xhsConnection.pendingReceipt.accountName} · {xhsConnection.pendingReceipt.schedule}</small>
            </span>
            <button type="button" onClick={() => void openXhsLogin()}>打开核对</button>
            {xhsConnection.pendingReceipt.status === "pending_confirmation" && (
              <button type="button" onClick={() => void resolveXhsPending("not_published")}>确认未发布</button>
            )}
            <button type="button" onClick={() => void resolveXhsPending("published")}>完成发布记录</button>
          </div>
        )}
        {showAISettings ? (
          <section className="ai-settings-page" aria-label="AI 接入设置">
            <header className="settings-page-head">
              <div>
                <span>可选能力</span>
                <h1>AI 接入设置</h1>
                <p>本地规则仍是默认方案。连接第三方模型后，可在文案区按需优化。</p>
              </div>
              <button type="button" aria-label="返回工作区" onClick={() => {
                if (aiConnectionDirty && !window.confirm("当前服务商或模型还没有保存。放弃这些连接修改并返回工作区？")) return;
                if (aiConnectionDirty) {
                  setAISettings({ ...aiSettings, baseUrl: savedAIConnection.baseUrl, model: savedAIConnection.model });
                  setAIKeyInput("");
                  setIsReplacingAIKey(false);
                  setAITestResult(null);
                  setTestedAIConnection(null);
                }
                setShowAISettings(false);
              }}><X /> 返回工作区</button>
            </header>
            <div className="settings-page-grid">
              <div className="settings-form">
                <section>
                  <div className="settings-section-title"><span>01</span><div><h2>连接信息</h2><p>兼容 OpenAI Chat Completions 接口格式。</p></div></div>
                  <div className="provider-picker">
                    <div><strong>选择服务商</strong><span>点击后自动填入官方兼容地址和建议模型，仍可继续修改。</span></div>
                    <div className="provider-grid" role="radiogroup" aria-label="AI 服务商">
                      {AI_PROVIDER_PRESETS.map((provider) => (
                        <button
                          type="button"
                          key={provider.id}
                          className={activeAIProviderId === provider.id ? "active" : ""}
                          role="radio"
                          aria-checked={activeAIProviderId === provider.id}
                          disabled={isTestingAISettings || isSavingAISettings}
                          onClick={() => selectAIProvider(provider)}
                        >
                          <i>{provider.mark}</i>
                          <span>
                            <strong>{provider.label}</strong>
                            <small title={provider.baseUrl || provider.note}>{provider.baseUrl || "自己填写 URL 与模型"}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <small className="provider-note">{activeAIProvider.note}</small>
                  </div>
                  <label><span>接口地址</span><input disabled={isTestingAISettings || isSavingAISettings} value={aiSettings.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => { setAISettings({ ...aiSettings, baseUrl: event.target.value }); setAITestResult(null); setTestedAIConnection(null); }} /></label>
                  <div className="settings-inline-fields">
                    <label><span>模型名称</span><input disabled={isTestingAISettings || isSavingAISettings} value={aiSettings.model} placeholder={activeAIProvider.model || "填写服务商提供的模型 ID"} onChange={(event) => { setAISettings({ ...aiSettings, model: event.target.value }); setAITestResult(null); setTestedAIConnection(null); }} /></label>
                    <div className="api-key-field">
                      <div><span>API Key</span>{savedKeyMatchesEndpoint && <button type="button" disabled={isTestingAISettings || isSavingAISettings} onClick={() => { setIsReplacingAIKey((value) => !value); setAIKeyInput(""); setAITestResult(null); setTestedAIConnection(null); }}>{isReplacingAIKey ? "取消更换" : "更换 Key"}</button>}</div>
                      <input aria-label="API Key" disabled={isTestingAISettings || isSavingAISettings || (savedKeyMatchesEndpoint && !isReplacingAIKey)} type="password" autoComplete="new-password" value={aiKeyInput} placeholder={savedKeyMatchesEndpoint && !isReplacingAIKey ? "已安全保存，切换模型会自动复用" : "填写该服务商的 API Key"} onChange={(event) => { setAIKeyInput(event.target.value); setAITestResult(null); setTestedAIConnection(null); }} />
                    </div>
                  </div>
                  <div className="connection-test-row">
                    <button type="button" className="test-ai" disabled={isTestingAISettings || isSavingAISettings} onClick={() => void testAIConfiguration()}>{isTestingAISettings ? "正在真实请求模型…" : "测试 API 与模型"}</button>
                    <span>会发送一条仅要求回复“OK”的最小请求，不会发送报告内容。</span>
                  </div>
                  {aiTestResult && <div className={`connection-result ${aiTestResult.status}`} role="status">{aiTestResult.status === "success" ? <CheckCircle weight="fill" /> : <X weight="bold" />}<span>{aiTestResult.message}</span></div>}
                </section>
                <section>
                  <div className="settings-section-title"><span>02</span><div><h2>生成规则</h2><p>仅在默认结果不满意时展开调整。</p></div></div>
                  <details>
                    <summary>高级设置：系统提示词</summary>
                    <textarea rows={14} value={aiSettings.systemPrompt || DEFAULT_SYSTEM_PROMPT} onChange={(event) => setAISettings({ ...aiSettings, systemPrompt: event.target.value })} />
                    <button type="button" onClick={() => setAISettings({ ...aiSettings, systemPrompt: "" })}>恢复默认提示词</button>
                  </details>
                </section>
              </div>
              <aside className="settings-guide">
                <div><span className={aiTestResult?.status === "success" ? "connected" : ""} /><strong>{aiTestResult?.status === "success" ? "本次连接测试通过" : aiConnectionDirty ? "连接修改尚未保存" : aiSettings.hasApiKey ? "本机已保存 Key，连接待测试" : "尚未完成接入"}</strong></div>
                <div className="settings-current-provider"><small>当前服务商</small><strong>{activeAIProvider.label}</strong><code>{aiSettings.model || "尚未填写模型"}</code></div>
                <h2>保存前先测试</h2>
                <ol><li>选择服务商或填写接口地址</li><li>修改准确的模型 ID；已有 Key 无需重复填写</li><li>点击“测试 API 与模型”</li><li>成功后保存，可继续切换其他模型</li></ol>
                <p>测试能定位地址、鉴权、模型和超时问题。报告内容只会在你主动点击“AI 优化文案”时发送。</p>
              </aside>
            </div>
            <footer className="settings-page-actions">
              <div>
                {aiSettings.hasApiKey && <button type="button" className="clear-key" onClick={() => void clearAIKey()}>清除已保存 Key</button>}
              </div>
              <button type="button" className="save-ai" disabled={isSavingAISettings || isTestingAISettings} onClick={() => void saveAIConfiguration()}>{isSavingAISettings ? "保存中…" : "保存设置"}</button>
            </footer>
          </section>
        ) : step === "upload" ? (
          <section className="upload-home">
            <div className="upload-home-copy">
              <span className="upload-kicker">从一份报告开始</span>
              <h1>
                上传文档，
                <br />
                一路生成
              </h1>
              <p>自动完成文案、封面和报告图片，审核后直接导出。</p>
            </div>
            <button
              className="hero-dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleFile(event.dataTransfer.files[0]);
              }}
            >
              <div className="dropzone-icon">
                <FileArrowUp weight="duotone" />
              </div>
              <strong>把 PDF 或 Word 拖到这里</strong>
              <span>也可以点击选择文件</span>
              <small>PDF 最大 80 MB / 120 页，DOCX 最大 30 MB</small>
            </button>
            <input
              ref={fileInputRef}
              hidden
              type="file"
              accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <div className="privacy-strip">
              <Sparkle weight="fill" />
              文档只在本机解析，不会自动上传
            </div>
            {history.length > 0 && <div className="recent-home">
              <div>
                <h2>最近任务</h2>
                <p>继续上次没有完成的内容</p>
              </div>
              <div className="recent-grid">
                {history.slice(0, 3).map((project) => (
                  <button
                    key={project.id}
                    onClick={() => void openProject(project)}
                  >
                    {project.kind === "pdf" ? <FilePdf /> : <FileDoc />}
                    <span>
                      <strong>
                        {project.name.replace(/\.(pdf|docx)$/i, "")}
                      </strong>
                      <small>
                        {project.kind === "pdf"
                          ? `${project.pageCount} 页`
                          : "Word 文档"}{" "}
                        · {bytes(project.size)}
                      </small>
                    </span>
                    <ArrowRight />
                  </button>
                ))}
              </div>
            </div>}
          </section>
        ) : report && draft ? (
          <div className="task-workspace">
            <header className="task-topbar">
              <button type="button" className="topbar-back" onClick={() => void goBack()}>
                <ArrowLeft />
                上一步
              </button>
              <div className="task-document">
                <span>{report.kind === "pdf" ? "PDF 报告" : "WORD 文档"}</span>
                <strong>{report.name}</strong>
              </div>
              <div className="topbar-actions">
                {step === "copy" && (
                  <button type="button" className="topbar-primary" onClick={() => void persist("images")}>
                    下一步：选择报告图片
                    <ArrowRight weight="bold" />
                  </button>
                )}
                {step === "images" && (
                  <button
                    type="button"
                    className="topbar-primary"
                    disabled={
                      (report.assets.length > 0 && selectedAssets.length === 0) ||
                      selectedAssets.length > MAX_SELECTED_REPORT_IMAGES ||
                      (report.kind === "pdf" && selectedAssets.length === 0)
                    }
                    onClick={() => void persist("review")}
                  >
                    下一步：最终审核
                    <ArrowRight weight="bold" />
                  </button>
                )}
                {step === "review" && (
                  <>
                    <button
                      type="button"
                      className="topbar-secondary"
                      disabled={!canFinish || isExporting}
                      onClick={() => void exportPackage()}
                    >
                      <DownloadSimple weight="bold" />
                      {isExporting ? "正在整理" : "导出内容包"}
                    </button>
                    <button
                      type="button"
                      className="topbar-primary"
                      disabled={!canFinish || isXhsSyncing || Boolean(xhsPrepared) || Boolean(xhsConnection.pendingReceipt)}
                      onClick={() => void prepareXhsPublish()}
                    >
                      <PaperPlaneTilt weight="bold" />
                      {isXhsSyncing ? "正在同步" : xhsConnection.pendingReceipt ? "上次发布待确认" : xhsPrepared ? "已同步到编辑页" : "同步至小红书编辑页"}
                    </button>
                  </>
                )}
              </div>
            </header>
            <div className="wizard-progress">
              {steps.map((item, index) => (
                <div
                  key={item.id}
                  aria-current={step === item.id ? "step" : undefined}
                  className={`${step === item.id ? "active" : ""} ${index < currentStepIndex ? "done" : ""}`}
                >
                  <span>
                    {index < currentStepIndex ? (
                      <Check weight="bold" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </div>
                </div>
              ))}
            </div>
            {step === "copy" &&
              report.kind === "pdf" &&
              report.assetStatus !== "ready" && (
                <div
                  className={`background-task ${report.assetStatus === "error" ? "error" : ""}`}
                  role="status"
                >
                  <Images weight="duotone" />
                  <div>
                    <strong>
                      {report.assetStatus === "error"
                        ? "自动提图没有完成"
                        : "文案已就绪，正在后台生成整页图片"}
                    </strong>
                    <small>
                      {report.assetStatus === "error"
                        ? "不影响文案编辑，可以在下一步手动裁切"
                        : `当前 ${assetProgress}%，你可以继续编辑或直接进入下一步`}
                    </small>
                  </div>
                  {report.assetStatus !== "error" && (
                    <span>{assetProgress}%</span>
                  )}
                </div>
              )}

            {step === "copy" && (
              <section className="step-panel copy-step" aria-label="文案与封面">
                <div className="copy-layout">
                  <div className={`copy-form ${isGeneratingAI ? "ai-busy" : ""}`} aria-busy={isGeneratingAI}>
                    {isGeneratingAI && (
                      <div className="ai-generation-overlay" role="status" aria-live="polite">
                        <div className="ai-proofing-card">
                          <div className="ai-proofing-mark" aria-hidden="true">
                            <Sparkle weight="fill" />
                            <span />
                          </div>
                          <span className={`ai-proofing-kicker ${aiGenerationPhase === "length-repair" ? "repair" : ""}`}>
                            {aiGenerationPhase === "length-repair" ? "长度自动校准 · 第 2 步" : "正在生成优化稿"}
                          </span>
                          <strong>{aiGenerationMessage}</strong>
                          <p>{aiGenerationPhase === "length-repair" ? aiLengthDirection === "short" ? `系统检测到初稿不足 ${POST_MIN_LENGTH} 字，正在自动补充报告里已有的信息；不需要重新点击。` : `系统检测到初稿超过 ${POST_MAX_LENGTH} 字，正在删减重复表达并保留关键结论。` : "原文会保留到新结果完整返回并通过字数、标签和事实校验。"}</p>
                          <div className="ai-proofing-track" aria-hidden="true"><span /></div>
                          <small>{savedAIProvider.label} · <span aria-hidden="true">已等待 {aiGenerationSeconds} 秒</span></small>
                        </div>
                      </div>
                    )}
                    <div className="copy-titlebar">
                      <label>标题</label>
                      <div>
                        {preAIDraft && <button type="button" className="undo-ai" onClick={() => { setDraft(preAIDraft); setPreAIDraft(null); setProjectStatus("draft"); flash("已恢复本地规则初稿"); }}>撤销 AI 优化</button>}
                        <button type="button" className="generate-ai" disabled={isGeneratingAI} onClick={() => void generateWithAI()}><Sparkle weight="fill" />{isGeneratingAI ? "正在优化…" : "AI 优化文案"}</button>
                      </div>
                    </div>
                    <div className="title-picks">
                      {draft.titles.slice(0, 3).map((title, index) => (
                        <div
                          key={index}
                          className={`title-pick-row ${draft.selectedTitle === index ? "selected" : ""}`}
                        >
                          <input
                            aria-label={`标题方案 ${index + 1}`}
                            value={title}
                            maxLength={20}
                            onFocus={() => setDraft({ ...draft, selectedTitle: index })}
                            onChange={(event) => {
                              setProjectStatus("draft");
                              setDraft({
                                ...draft,
                                selectedTitle: index,
                                titles: draft.titles.slice(0, 3).map((item, titleIndex) => titleIndex === index ? event.target.value : item),
                              });
                            }}
                          />
                          <button
                            type="button"
                            aria-label={`选择标题方案 ${index + 1}`}
                            aria-pressed={draft.selectedTitle === index}
                            onClick={() => { setProjectStatus("draft"); setDraft({ ...draft, selectedTitle: index }); }}
                          >
                            {draft.selectedTitle === index ? <CheckCircle weight="fill" /> : <span />}
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="textarea-label">
                      <label>正文与标签</label>
                      <span>
                        {postAnalysis.contentLength} / 正文要求 {POST_MIN_LENGTH}–{POST_MAX_LENGTH} 字 ·{" "}
                        {postAnalysis.tagCount} 个标签
                      </span>
                    </div>
                    <textarea
                      value={draft.body}
                      onChange={(event) => {
                        setProjectStatus("draft");
                        setDraft({ ...draft, body: event.target.value });
                      }}
                      onBlur={() => setDraft({ ...draft, body: finalBody })}
                    />
                  </div>
                  <div className="cover-editor">
                    <div className="cover-toolbar">
                      <div>
                        <strong>报告观察家封面</strong>
                        <span>标题不含来源，来源单独保留</span>
                      </div>
                      <div className="cover-toolbar-actions">
                        {(["signal", "editorial", "data"] as CoverStyle[]).map(
                          (style) => (
                            <button
                              key={style}
                              className={coverStyle === style ? "active" : ""}
                              onClick={() => {
                                setProjectStatus("draft");
                                setCoverStyle(style);
                              }}
                            >
                              {style === "signal"
                                ? "雾紫刊"
                                : style === "editorial"
                                  ? "暖纸刊"
                                  : "雾蓝刊"}
                            </button>
                          ),
                        )}
                        <button
                          type="button"
                          className={showCoverControls ? "active" : ""}
                          onClick={() => setShowCoverControls((value) => !value)}
                          aria-pressed={showCoverControls}
                        >
                          <PencilSimple /> 编辑
                        </button>
                      </div>
                    </div>
                    {showCoverControls && coverCustomization && (
                      <div className="cover-edit-note">
                        <span>直接点击虚线框内文字修改，拖动右上角手柄移动</span>
                        <button type="button" onClick={() => { setProjectStatus("draft"); setCoverCustomization({ ...coverCustomization, positions: defaultCoverCustomization(report).positions }); }}>恢复默认位置</button>
                      </div>
                    )}
                    <div className={`cover-stage ${showCoverControls ? "editing" : ""}`} ref={coverStageRef}>
                      <img src={showCoverControls ? coverEditUrl : coverUrl} alt={`${coverCustomization?.title || reportTitle} 封面预览`} />
                      {!showCoverControls && coverCustomization && (['source', 'title', 'english'] as CoverTextLayer[]).map((layer) => (
                        <button
                          type="button"
                          key={layer}
                          className={`cover-text-hotspot ${layer}`}
                          style={coverLayerLayout(layer)}
                          aria-label={`点击编辑${layer === "source" ? "报告来源" : layer === "title" ? "中文标题" : "英文标题"}`}
                          onClick={() => setShowCoverControls(true)}
                        />
                      ))}
                      {showCoverControls && coverCustomization && (["source", "title", "english"] as CoverTextLayer[]).map((layer) => {
                        const value = layer === "source" ? `来源：${coverCustomization.source}` : layer === "title" ? coverCustomization.title : coverCustomization.english;
                        const titleLength = Array.from(coverCustomization.title.replace(/\s+/g, "")).length;
                        const englishLength = Math.max(1, Array.from(coverCustomization.english).length);
                        const editFontSize = layer === "title"
                          ? (titleLength <= 12 ? 22 : titleLength <= 22 ? 18 : titleLength <= 30 ? 15 : 13)
                          : layer === "english"
                            ? Math.max(4, Math.min(8, 828 / englishLength))
                            : undefined;
                        return (
                          <div
                            className={`cover-text-layer ${layer} ${coverStyle}`}
                            key={layer}
                            style={coverLayerLayout(layer)}
                          >
                            <textarea
                              aria-label={layer === "source" ? "编辑报告来源" : layer === "title" ? "编辑中文标题" : "编辑英文标题"}
                              rows={layer === "source" ? 1 : 2}
                              maxLength={layer === "source" ? 35 : layer === "title" ? 40 : 120}
                              value={value}
                              style={editFontSize ? { fontSize: `${editFontSize / 3}cqw` } : undefined}
                              onChange={(event) => {
                                const rawValue = event.target.value.replace(/\n+/g, " ");
                                const nextValue = layer === "source"
                                  ? rawValue.replace(/^来源[：:]?\s*/, "")
                                  : layer === "title"
                                    ? maskRestrictedBrands(normalizeCoverTitle(rawValue, coverCustomization.source))
                                    : rawValue.toUpperCase();
                                setProjectStatus("draft");
                                if (layer === "source") {
                                  setCoverCustomization({
                                    ...coverCustomization,
                                    source: nextValue,
                                    title: maskRestrictedBrands(normalizeCoverTitle(coverCustomization.title, nextValue)),
                                  });
                                } else {
                                  setCoverCustomization({ ...coverCustomization, [layer]: nextValue });
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="cover-move-handle"
                              aria-label={`移动${layer === "source" ? "报告来源" : layer === "title" ? "中文标题" : "英文标题"}，可拖动或使用方向键`}
                              onPointerDown={(event) => beginCoverDrag(layer, event)}
                              onLostPointerCapture={() => { coverDragRef.current = null; }}
                              onKeyDown={(event) => nudgeCoverLayer(layer, event)}
                            ><DotsSixVertical weight="bold" /></button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {step === "images" && (
              <section
                className="step-panel image-step"
                data-asset-status={report.assetStatus ?? "ready"}
              >
                <div className="step-heading">
                  <span>报告图片</span>
                  <h1>选择真正要发布的图片</h1>
                  <p>
                    {report.kind === "pdf"
                      ? `PDF 每一页都会完整生成图片，并按页码排序。请选择要发布的 1-${MAX_SELECTED_REPORT_IMAGES} 页。`
                      : `已提取 Word 文档中的原图，请选择要发布的 1-${MAX_SELECTED_REPORT_IMAGES} 张。`}
                  </p>
                </div>
                <div className="asset-summary">
                  <div>
                    <Images weight="duotone" />
                    <span>
                      <strong>
                        {assetsBusy
                          ? `整页图片生成中 · ${assetProgress}%`
                          : report.kind === "pdf"
                            ? `已生成 ${report.assets.filter((asset) => asset.source !== "crop").length} 页`
                            : `已提取 ${report.assets.filter((asset) => asset.source !== "crop").length} 张原图`}
                      </strong>
                      <small
                        className={
                          report.assets.length > 0 &&
                          selectedAssets.length === 0
                            ? "selection-warning"
                            : ""
                        }
                      >
                        已选择 {selectedAssets.length} / {MAX_SELECTED_REPORT_IMAGES}
                        {report.assets.length > 0 && selectedAssets.length === 0
                          ? "，请至少选择 1 张"
                          : ""}
                      </small>
                    </span>
                  </div>
                  {report.kind === "pdf" && report.pages.length > 0 && (
                    <button
                      onClick={() => {
                        setCropPage(report.pages[0].pageNumber);
                        setShowCropper(true);
                      }}
                    >
                      <Scissors />
                      从页面手动裁切
                    </button>
                  )}
                </div>
                {assetsBusy && report.assets.length === 0 ? (
                  <div className="asset-loading" role="status">
                    <div className="asset-loading-icon">
                      <Images weight="duotone" />
                    </div>
                    <h3>正在逐页生成完整图片</h3>
                    <p>文案已经可以使用，页面图片会按 P1、P2、P3 顺序出现。</p>
                    <div className="asset-loading-track">
                      <span style={{ width: `${assetProgress}%` }} />
                    </div>
                    <small>{assetProgress}%</small>
                  </div>
                ) : report.assets.length ? (
                  <div className="asset-grid">
                    {report.assets.map((asset) => (
                      <button
                        aria-pressed={asset.selected}
                        key={asset.id}
                        className={
                          asset.selected ? "asset-card selected" : "asset-card"
                        }
                        onClick={() => toggleAsset(asset.id)}
                      >
                        <img
                          src={asset.imageUrl}
                          loading="lazy"
                          decoding="async"
                          alt={
                            asset.source === "docx"
                              ? "Word 文档提取图片"
                              : `第 ${asset.pageNumber} 页提取图片`
                          }
                        />
                        <span>
                          {asset.source === "crop"
                            ? `手动裁切 · P.${asset.pageNumber}`
                            : asset.source === "docx"
                              ? "Word 文档原图"
                              : asset.source === "embedded"
                                ? `示例图表 · P.${asset.pageNumber}`
                                : `PDF 整页图片 · P.${asset.pageNumber}`}
                        </span>
                        {asset.selected && (
                          <i>
                            <Check weight="bold" />
                          </i>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="asset-empty">
                    <Images weight="duotone" />
                    <h3>没有生成整页图片</h3>
                    <p>
                      {report.kind === "pdf"
                        ? "整页图片生成失败，可以重新打开任务再试。"
                        : "这份 Word 文档没有图片，可以直接进入审核。"}
                    </p>
                    {report.kind === "pdf" && (
                      <button onClick={() => setShowCropper(true)}>
                        <Scissors />
                        开始裁切
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}

            {step === "review" && (
              <section className="step-panel review-step">
                <div className="step-heading">
                  <span>最终审核</span>
                  <h1>确认内容，再同步发布</h1>
                  <p>先核对标题、正文和图片；确认无误后再同步到小红书编辑页。</p>
                </div>
                <div className="review-grid">
                  <div className="review-cover">
                    <img src={coverUrl} alt={`${reportTitle} 最终封面`} />
                    <span>封面 1 张</span>
                  </div>
                  <div className="review-content">
                    <div className="review-title-row">
                      <div>
                        <small>小红书发布标题</small>
                        <h2>{draft.titles[draft.selectedTitle]}</h2>
                      </div>
                      <button onClick={copyPost}>
                        <Copy />
                        复制纯文本
                      </button>
                    </div>
                    <div className="review-checks">
                      <span
                        className={
                          postAnalysis.contentLength >= minimumContentLength &&
                          postAnalysis.contentLength <= POST_MAX_LENGTH
                            ? "pass"
                            : "warn"
                        }
                      >
                        <CheckCircle weight="fill" />
                        正文 {postAnalysis.contentLength} 字
                      </span>
                      <span
                        className={
                          postAnalysis.tagCount === 10 ? "pass" : "warn"
                        }
                      >
                        <CheckCircle weight="fill" />
                        标签 {postAnalysis.tagCount} 个
                      </span>
                      <span
                        className={
                          postAnalysis.restrictedBrands.length === 0
                            ? "pass"
                            : "warn"
                        }
                      >
                        <CheckCircle weight="fill" />
                        {postAnalysis.restrictedBrands.length === 0
                          ? "常见品牌词已转换"
                          : "仍有已知品牌词需检查"}
                      </span>
                      <span
                        className={
                          selectedAssets.length > 0 ||
                          (report.kind === "docx" && report.assets.length === 0)
                            ? "pass"
                            : "warn"
                        }
                      >
                        <CheckCircle weight="fill" />
                        报告图片 {selectedAssets.length} 张
                      </span>
                    </div>
                    <div className="xhs-publish-card">
                      <div className="xhs-publish-head">
                        <div>
                          <span><PaperPlaneTilt weight="fill" />小红书自动发布</span>
                          <strong>先同步并校验，再确认定时发布</strong>
                        </div>
                        <div className={`xhs-account-state ${xhsConnection.connected ? "connected" : ""}`}>
                          <i />
                          {xhsConnection.connected
                            ? xhsConnection.accountName ? `@${xhsConnection.accountName}` : "账号已连接"
                            : xhsConnection.hasSavedSession ? "有本地登录记录" : "未连接"}
                        </div>
                      </div>
                      <div className="xhs-publish-options">
                        <div className="xhs-option-row">
                          <UsersThree weight="duotone" />
                          <span>
                            <small>群聊</small>
                            <strong>自动选择人数最少的群聊</strong>
                          </span>
                          {xhsPrepared?.group && <em>{xhsPrepared.group.name} · {xhsPrepared.group.count} 人</em>}
                        </div>
                        <label className="xhs-option-row xhs-schedule-field">
                          <CalendarBlank weight="duotone" />
                          <span>
                            <small>定时发布</small>
                            <strong>北京时间，须在 1 小时至 14 天内</strong>
                          </span>
                          <input
                            type="datetime-local"
                            min={scheduleBounds.min}
                            max={scheduleBounds.max}
                            value={xhsPublishSettings.scheduleAt}
                            disabled={isXhsSyncing || Boolean(xhsPrepared)}
                            onChange={(event) => {
                              setXhsPublishSettings((current) => ({ ...current, scheduleAt: event.target.value }));
                              setProjectStatus("draft");
                            }}
                          />
                        </label>
                      </div>
                      <div
                        className={`xhs-progress ${xhsProgress?.stage === "failed" ? "error" : xhsProgress?.stage === "submitted_unknown" ? "warning" : ""}`}
                        role="status"
                        aria-live="polite"
                      >
                        {xhsProgress?.stage === "prepared" ? <ShieldCheck weight="fill" /> : <LinkSimple weight="bold" />}
                        <span>
                          <strong>{xhsProgress?.message ?? "文案和图片只会在你点击同步后发送到小红书"}</strong>
                          <small>专用可见浏览器 · 不读取 Atlas Cookie · 失败不自动重试</small>
                        </span>
                      </div>
                      {xhsConnection.pendingReceipt ? (
                        <div className="xhs-pending-gate">
                          <div>
                            <ShieldCheck weight="fill" />
                            <span>
                              <strong>
                                {xhsConnection.pendingReceipt.status === "confirmed_published"
                                  ? "平台已确认发布，完成本地记录后解除锁定"
                                  : "上一次发布结果待人工确认，已锁定重复发布"}
                              </strong>
                              <small>
                                @{xhsConnection.pendingReceipt.accountName} · {xhsConnection.pendingReceipt.group.name}（{xhsConnection.pendingReceipt.group.count} 人）· {xhsConnection.pendingReceipt.schedule}
                              </small>
                            </span>
                          </div>
                          <div>
                            <button type="button" onClick={() => void openXhsLogin()}>打开官方页面核对</button>
                            {xhsConnection.pendingReceipt.status === "pending_confirmation" && (
                              <button type="button" onClick={() => void resolveXhsPending("not_published")}>确认没有发布</button>
                            )}
                            <button type="button" onClick={() => void resolveXhsPending("published")}>确认已经发布</button>
                          </div>
                        </div>
                      ) : !xhsPrepared ? (
                        <div className="xhs-publish-actions">
                          <button type="button" className="xhs-connect-button" disabled={isXhsSyncing || isXhsSubmitting} onClick={() => void openXhsLogin()}>
                            <LinkSimple />
                            {xhsConnection.connected ? "打开小红书窗口" : "连接小红书"}
                          </button>
                          {xhsConnection.connected && (
                            <button type="button" className="xhs-disconnect-button" disabled={isXhsSyncing || isXhsSubmitting} onClick={() => void disconnectXhs()}>退出账号</button>
                          )}
                          <button
                            type="button"
                            className="xhs-sync-button"
                            disabled={!canFinish || isXhsSyncing || isXhsSubmitting || !isValidScheduleValue(xhsPublishSettings.scheduleAt)}
                            onClick={() => void prepareXhsPublish()}
                          >
                            <PaperPlaneTilt weight="bold" />
                            {isXhsSyncing ? "正在同步并校验…" : "同步到小红书编辑页"}
                          </button>
                        </div>
                      ) : (
                        <div className="xhs-final-gate">
                          <label>
                            <input
                              type="checkbox"
                              checked={xhsFinalConfirmed}
                              onChange={(event) => setXhsFinalConfirmed(event.target.checked)}
                            />
                            我已在小红书窗口核对账号、图片顺序、群聊和定时时间
                          </label>
                          <button
                            type="button"
                            disabled={!xhsFinalConfirmed || isXhsSubmitting}
                            onClick={() => void submitXhsScheduled()}
                          >
                            <ClockCounterClockwise weight="bold" />
                            {isXhsSubmitting ? "正在提交…" : `确认定时发布 · ${xhsPrepared.schedule}`}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="review-assets">
                      <small>发布图片顺序</small>
                      <div>
                        <figure>
                          <img src={coverUrl} alt="封面缩略图" />
                          <figcaption>封面</figcaption>
                        </figure>
                        {selectedAssets.map((asset, index) => (
                          <figure key={asset.id}>
                            <img
                              src={asset.imageUrl}
                              alt={`发布图片 ${index + 2}`}
                            />
                            <figcaption>{index + 2}</figcaption>
                          </figure>
                        ))}
                      </div>
                    </div>
                    <div className="body-preview">{finalBody}</div>
                  </div>
                </div>
              </section>
            )}
          </div>
        ) : null}
      </main>

      {isParsing && (
        <div className="parse-overlay">
          <div className="parse-card" role="status" aria-live="polite">
            <div className="parsing-doc">
              <FilePdf weight="duotone" />
            </div>
            <h2>正在解析文档</h2>
            <p>{parseMessage}</p>
            <div
              className="parse-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={parseProgress}
            >
              <span style={{ width: `${parseProgress}%` }} />
            </div>
            <small>{parseProgress}%</small>
          </div>
        </div>
      )}
      {showCropper && report && (
        <div className="crop-overlay">
          <div
            ref={cropDialogRef}
            className="crop-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="crop-title"
          >
            <button
              ref={cropCloseRef}
              className="crop-close"
              aria-label="关闭裁切窗口"
              onClick={() => setShowCropper(false)}
            >
              <X />
            </button>
            <div className="crop-dialog-head">
              <span>手动裁切</span>
              <h2 id="crop-title">框选要发布的图表区域</h2>
              <p>
                拖动选框，只保留图表和必要文字。输出会从原 PDF 重新高清渲染。
              </p>
            </div>
            <div className="crop-controls">
              <label>
                选择页面
                <select
                  value={cropPage}
                  onChange={(event) => {
                    setCropPage(Number(event.target.value));
                    const reset = {
                      unit: "%",
                      x: 10,
                      y: 15,
                      width: 80,
                      height: 60,
                    } as PercentCrop;
                    setCrop(reset);
                    setCompletedCrop(null);
                  }}
                >
                  {report.pages.map((page) => (
                    <option value={page.pageNumber} key={page.pageNumber}>
                      第 {page.pageNumber} 页
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {isCropPreviewLoading ? (
              <div className="crop-preview-loading" role="status">
                <Images weight="duotone" />
                <span>正在生成第 {cropPage} 页预览</span>
              </div>
            ) : cropPreviewUrl ? (
              <div className="crop-canvas">
                <ReactCrop
                  crop={crop}
                  onChange={(_, nextPercent) => setCrop(nextPercent)}
                  onComplete={(nextCrop) => setCompletedCrop(nextCrop)}
                >
                  <img
                    ref={cropImageRef}
                    src={cropPreviewUrl}
                    alt={`第 ${cropPage} 页`}
                    onLoad={(event) => {
                      const image = event.currentTarget;
                      setCompletedCrop({
                        unit: "px",
                        x: image.width * 0.1,
                        y: image.height * 0.15,
                        width: image.width * 0.8,
                        height: image.height * 0.6,
                      });
                    }}
                  />
                </ReactCrop>
              </div>
            ) : null}
            <div className="crop-actions">
              <button onClick={() => setShowCropper(false)}>取消</button>
              <button
                disabled={
                  isCropping || isCropPreviewLoading || !completedCrop
                }
                onClick={() => void addCrop()}
              >
                <Scissors />
                {isCropping ? "正在生成高清图" : "加入候选图片"}
              </button>
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div className="wizard-toast" role="status">
          <CheckCircle weight="fill" />
          {notice}
        </div>
      )}
    </div>
  );
}
