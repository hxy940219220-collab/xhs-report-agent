export type ReportPage = {
  pageNumber: number;
  text: string;
  imageUrl: string;
  selected: boolean;
};

export type ReportAsset = {
  id: string;
  pageNumber: number;
  imageUrl: string;
  width: number;
  height: number;
  selected: boolean;
  source: "page" | "embedded" | "crop" | "docx";
};

export type ReportFile = {
  kind: "pdf" | "docx";
  name: string;
  size: number;
  pageCount: number;
  pages: ReportPage[];
  assets: ReportAsset[];
  extractedText: string;
  sourceData?: ArrayBuffer;
  assetStatus?: "pending" | "extracting" | "ready" | "error";
  assetProgress?: number;
};

export type Draft = {
  titles: string[];
  selectedTitle: number;
  body: string;
  tags: string[];
  sources: { page: number; quote: string }[];
};

export type CoverStyle = "signal" | "editorial" | "data";

export type CoverTextLayer = "source" | "title" | "english";

export type CoverCustomization = {
  source: string;
  title: string;
  english: string;
  positions: Record<CoverTextLayer, { x: number; y: number }>;
};

export type XhsPublishSettings = {
  scheduleAt: string;
  groupStrategy: "smallest";
};

export type XhsConnectionStatus = {
  connected: boolean;
  hasSavedSession?: boolean;
  accountName: string;
  url: string;
  pendingReceipt?: XhsPendingReceipt | null;
};

export type XhsPendingReceipt = {
  id: string;
  projectId: string;
  title: string;
  accountName: string;
  group: { name: string; count: number };
  schedule: string;
  imageCount: number;
  clickedAt: number;
  status: "pending_confirmation" | "confirmed_published";
};

export type XhsPublishProgress = {
  stage:
    | "preparing"
    | "awaiting_login"
    | "connected"
    | "opening_editor"
    | "uploading"
    | "filling"
    | "tags"
    | "group"
    | "schedule"
    | "prepared"
    | "submitting"
    | "submitted"
    | "submitted_unknown"
    | "failed"
    | "window_closed";
  message: string;
  attemptId?: string;
  accountName?: string;
  current?: number;
  total?: number;
  schedule?: string;
  group?: { name: string; count: number };
};

export type XhsPrepareRequest = {
  projectId: string;
  title: string;
  content: string;
  tags: string[];
  images: string[];
  scheduleAt: string;
  groupStrategy: "smallest";
};

export type XhsPreparedResult = {
  status: "prepared";
  attemptId: string;
  accountName: string;
  schedule: string;
  group: { name: string; count: number };
  imageCount: number;
};

export type ProjectGroup = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectRecord = {
  id: string;
  name?: string;
  report: ReportFile;
  draft: Draft;
  groupId?: string;
  coverStyle: CoverStyle;
  coverCustomization?: CoverCustomization;
  generationMode?: "local" | "ai";
  preAIDraft?: Draft;
  xhsPublishSettings?: XhsPublishSettings;
  step?: "copy" | "images" | "review";
  status?: "draft" | "completed";
  updatedAt: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  kind: "pdf" | "docx";
  size: number;
  pageCount: number;
  groupId?: string;
  step?: "copy" | "images" | "review";
  status?: "draft" | "completed";
  updatedAt: number;
};
