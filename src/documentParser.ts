import type { ReportAsset, ReportFile, ReportPage } from "./types";
import JSZip from "jszip";

type ProgressCallback = (progress: number, message: string) => void;

async function renderPageAsset(page: any, pageNumber: number): Promise<ReportAsset> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    3,
    1600 / Math.max(baseViewport.width, baseViewport.height),
    Math.sqrt(2_500_000 / (baseViewport.width * baseViewport.height)),
  );
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法生成 PDF 整页图片");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return { id: `page-${pageNumber}`, pageNumber, imageUrl: canvas.toDataURL("image/jpeg", .9), width: canvas.width, height: canvas.height, selected: false, source: "page" };
}

export async function parsePdfDocument(file: File, onProgress: ProgressCallback): Promise<ReportFile> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const buffer = await file.arrayBuffer();
  const sourceData = buffer.slice(0);
  if (new TextDecoder("ascii").decode(buffer.slice(0, 5)) !== "%PDF-") throw new Error("文件内容不是有效的 PDF");
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  if (pdf.numPages > 120) {
    await pdf.destroy();
    throw new Error(`当前最多处理 120 页，这份报告有 ${pdf.numPages} 页`);
  }
  const pages: ReportPage[] = [];
  let completedPages = 0;
  let nextPage = 1;
  const workers = Array.from({ length: Math.min(4, pdf.numPages) }, async () => {
    while (nextPage <= pdf.numPages) {
      const pageNumber = nextPage;
      nextPage += 1;
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => "str" in item ? `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : " "}` : "").join("");
      pages[pageNumber - 1] = { pageNumber, text: pageText, imageUrl: "", selected: false };
      page.cleanup();
      completedPages += 1;
      onProgress(Math.round((completedPages / pdf.numPages) * 100), `正在提取文字 ${completedPages} / ${pdf.numPages} 页`);
    }
  });
  await Promise.all(workers);
  const textParts = pages.map((page) => `[第 ${page.pageNumber} 页] ${page.text}`);
  const extractedText = textParts.join("\n");
  const pageCount = pdf.numPages;
  await pdf.destroy();
  if (extractedText.replace(/\s/g, "").length < 120) throw new Error("没有提取到足够文字，扫描版报告需要先完成 OCR");
  onProgress(100, "文字解析完成，正在后台提取图片");
  return { kind: "pdf", name: file.name, size: file.size, pageCount, pages, assets: [], extractedText, sourceData, assetStatus: "pending", assetProgress: 0 };
}

export async function extractPdfAssets(sourceData: ArrayBuffer, onProgress: ProgressCallback, signal?: AbortSignal) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjsLib.getDocument({ data: sourceData.slice(0) }).promise;
  const assets: ReportAsset[] = [];
  const failedPages: number[] = [];
  try {
    let nextPage = 1;
    let completedPages = 0;
    const workers = Array.from({ length: Math.min(2, pdf.numPages) }, async () => {
      while (nextPage <= pdf.numPages) {
        if (signal?.aborted) throw new DOMException("图片提取已取消", "AbortError");
        const pageNumber = nextPage;
        nextPage += 1;
        const page = await pdf.getPage(pageNumber);
        try {
          assets.push(await renderPageAsset(page, pageNumber));
        } catch {
          failedPages.push(pageNumber);
        } finally {
          page.cleanup();
        }
        completedPages += 1;
        onProgress(Math.round((completedPages / pdf.numPages) * 100), `后台生成整页图片 ${completedPages} / ${pdf.numPages} 页`);
      }
    });
    await Promise.all(workers);
    if (failedPages.length) {
      throw new Error(`第 ${failedPages.sort((a, b) => a - b).join("、")} 页生成失败，请重试`);
    }
    if (assets.length !== pdf.numPages) throw new Error("PDF 页数与生成图片数量不一致，请重试");
    return assets.sort((first, second) => first.pageNumber - second.pageNumber || first.id.localeCompare(second.id));
  } finally {
    await pdf.destroy();
  }
}

export async function parseDocxDocument(file: File, onProgress: ProgressCallback): Promise<ReportFile> {
  const mammoth = await import("mammoth");
  onProgress(10, "正在读取 Word 文档");
  const arrayBuffer = await file.arrayBuffer();
  const archive = await JSZip.loadAsync(arrayBuffer);
  const archiveEntries = Object.values(archive.files).filter((entry) => !entry.dir);
  const archiveSizes = archiveEntries.map((entry) => Number((entry as any)._data?.uncompressedSize ?? 0));
  const totalArchiveBytes = archiveSizes.reduce((sum, size) => sum + size, 0);
  if (archiveSizes.some((size) => size > 40_000_000) || totalArchiveBytes > 120_000_000) {
    throw new Error("Word 文档解压后过大，请精简内容或压缩图片后再上传");
  }
  const mediaEntries = Object.values(archive.files).filter((entry) => !entry.dir && /^word\/media\//i.test(entry.name));
  const mediaSizes = mediaEntries.map((entry) => Number((entry as any)._data?.uncompressedSize ?? 0));
  const totalMediaBytes = mediaSizes.reduce((sum, size) => sum + size, 0);
  if (mediaEntries.length > 20) throw new Error(`Word 文档包含 ${mediaEntries.length} 张图片，当前最多处理 20 张`);
  if (mediaSizes.some((size) => size > 25_000_000) || totalMediaBytes > 60_000_000) throw new Error("Word 文档内图片解压后过大，请先压缩图片再上传");
  const assets: ReportAsset[] = [];
  let decodedImageBytes = 0;
  let remainingImagePixels = 80_000_000;
  await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read("base64");
        const imageUrl = `data:${image.contentType};base64,${base64}`;
        const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
          const element = new Image();
          element.onload = () => resolve({ width: element.naturalWidth, height: element.naturalHeight });
          element.onerror = () => resolve({ width: 0, height: 0 });
          element.src = imageUrl;
        });
        decodedImageBytes += Math.ceil(base64.length * .75);
        const imagePixels = dimensions.width * dimensions.height;
        if (assets.length < 20 && decodedImageBytes <= 60_000_000 && dimensions.width >= 180 && dimensions.height >= 120 && imagePixels <= 16_000_000 && imagePixels <= remainingImagePixels) {
          assets.push({ id: `docx-${assets.length}`, pageNumber: 0, imageUrl, ...dimensions, selected: assets.length < 3, source: "docx" });
          remainingImagePixels -= imagePixels;
        }
        return { src: imageUrl };
      }),
    },
  );
  onProgress(70, "正在提取正文和图片");
  const result = await mammoth.extractRawText({ arrayBuffer });
  const extractedText = result.value.trim();
  if (extractedText.replace(/\s/g, "").length < 120) throw new Error("Word 文档文字太少，暂时无法生成可靠文案");
  onProgress(100, `解析完成，找到 ${assets.length} 张图片`);
  return { kind: "docx", name: file.name, size: file.size, pageCount: 1, pages: [], assets, extractedText };
}

export async function renderPdfPagePreview(sourceData: ArrayBuffer, pageNumber: number) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjsLib.getDocument({ data: sourceData.slice(0) }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, 1200 / baseViewport.width, Math.sqrt(2_000_000 / (baseViewport.width * baseViewport.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("无法生成页面预览");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    page.cleanup();
    return canvas.toDataURL("image/jpeg", .82);
  } finally {
    await pdf.destroy();
  }
}

export async function renderPdfCrop(sourceData: ArrayBuffer, pageNumber: number, bounds: { x: number; y: number; width: number; height: number }) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjsLib.getDocument({ data: sourceData.slice(0) }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxCropPixels = 12_000_000;
    const maxCanvasSide = 8192;
    const scale = Math.min(3, 1800 / baseViewport.width, maxCanvasSide / baseViewport.width, maxCanvasSide / baseViewport.height, Math.sqrt(maxCropPixels / (baseViewport.width * baseViewport.height)));
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("PDF 页面尺寸异常，无法裁切");
    const viewport = page.getViewport({ scale });
    const sourceWidth = Math.round(viewport.width);
    const sourceHeight = Math.round(viewport.height);
    if (sourceWidth < 1 || sourceHeight < 1 || sourceWidth > maxCanvasSide || sourceHeight > maxCanvasSide || sourceWidth * sourceHeight > maxCropPixels) throw new Error("PDF 页面尺寸过大，无法安全裁切");
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceContext = sourceCanvas.getContext("2d", { alpha: false });
    if (!sourceContext) throw new Error("无法渲染高分辨率裁切图");
    await page.render({ canvas: sourceCanvas, canvasContext: sourceContext, viewport }).promise;
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = Math.max(1, Math.round(sourceCanvas.width * bounds.width));
    outputCanvas.height = Math.max(1, Math.round(sourceCanvas.height * bounds.height));
    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) throw new Error("无法生成裁切图");
    outputContext.drawImage(sourceCanvas, sourceCanvas.width * bounds.x, sourceCanvas.height * bounds.y, sourceCanvas.width * bounds.width, sourceCanvas.height * bounds.height, 0, 0, outputCanvas.width, outputCanvas.height);
    page.cleanup();
    return { imageUrl: outputCanvas.toDataURL("image/png"), width: outputCanvas.width, height: outputCanvas.height };
  } finally {
    await pdf.destroy();
  }
}

export async function parseDocument(file: File, onProgress: ProgressCallback) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".pdf")) {
    if (file.size > 80 * 1024 * 1024) throw new Error("PDF 不能超过 80 MB");
    return parsePdfDocument(file, onProgress);
  }
  if (lowerName.endsWith(".docx")) {
    if (file.size > 30 * 1024 * 1024) throw new Error("DOCX 不能超过 30 MB");
    return parseDocxDocument(file, onProgress);
  }
  if (lowerName.endsWith(".doc")) throw new Error("暂不支持旧版 .doc，请先在 Word 中另存为 .docx");
  throw new Error("请选择 PDF 或 DOCX 文档");
}
