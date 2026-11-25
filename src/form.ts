import type { ApprovalConfig } from "./config";
import { dateIn } from "./date";

export interface LeaveRange {
  startDate: string; // YYYY-MM-DD theo timezone
  endDate: string;   // ngày cuối cùng có hiệu lực (inclusive)
  endUnix: number;   // thời điểm tắt status, Unix giây = end thật của đơn
}

export function parseForm(
  formJson: string,
  cfg: ApprovalConfig,
  timeZone: string,
): LeaveRange | null {
  // v1: chỉ hỗ trợ widget khoảng thời gian; widget date rời chưa cần
  if (cfg.startField !== cfg.endField) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(formJson);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const widget = parsed.find(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && (item as Record<string, unknown>).id === cfg.startField,
  );
  if (!widget) {
    return null;
  }

  const val = widget.value;
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    return null;
  }

  const { start, end } = val as Record<string, unknown>;
  if (typeof start !== "string" || typeof end !== "string") {
    return null;
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  try {
    const startDate = dateIn(startMs, timeZone);
    const endDate = dateIn(endMs - 1, timeZone);
    const endUnix = Math.floor(endMs / 1000);
    return { startDate, endDate, endUnix };
  } catch {
    return null;
  }
}
