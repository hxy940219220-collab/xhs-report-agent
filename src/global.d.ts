import type { AISettings } from "./aiClient";
import type {
  XhsConnectionStatus,
  XhsPrepareRequest,
  XhsPreparedResult,
  XhsPublishProgress,
} from "./types";

declare global {
  interface Window {
    reportAgentAI?: {
      getSettings: () => Promise<AISettings>;
      saveSettings: (settings: { baseUrl: string; model: string; systemPrompt: string; apiKey?: string }) => Promise<AISettings>;
      testConnection: (settings: { baseUrl: string; model: string; apiKey?: string }) => Promise<{ ok: true; latencyMs: number; model: string; reply: string }>;
      clearKey: () => Promise<AISettings>;
      generateCopy: (request: { systemPrompt: string; userPrompt: string }) => Promise<string>;
    };
    reportAgentXhs?: {
      getStatus: () => Promise<XhsConnectionStatus>;
      openLogin: () => Promise<XhsConnectionStatus>;
      preparePublish: (request: XhsPrepareRequest) => Promise<XhsPreparedResult>;
      submitScheduled: (request: { attemptId: string; confirmation: "CONFIRM_SCHEDULE_PUBLISH" }) => Promise<{ status: "submitted" | "submitted_unknown"; confirmed: boolean }>;
      resolvePending: (resolution: "published" | "not_published") => Promise<XhsConnectionStatus & { resolution: "published" | "not_published" }>;
      disconnect: () => Promise<XhsConnectionStatus>;
      onProgress: (listener: (progress: XhsPublishProgress) => void) => () => void;
    };
  }
}

export {};
