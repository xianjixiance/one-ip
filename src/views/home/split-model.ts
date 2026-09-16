import { normalizeIp } from "@/lib/ip-address";
import type { Geo } from "@/lib/types";
import type { Site } from "./api";

export const categories = [
  ["all", "全部"],
  ["domestic", "国内"],
  ["international", "国际"],
  ["ai", "AI 服务"],
  ["social", "社交社区"],
  ["dev", "开发平台"],
  ["static", "静态资源"],
  ["tools", "实用工具"],
  ["media", "流媒体"],
  ["ecommerce", "跨境电商"],
  ["crypto", "加密货币"],
  ["speed", "测速服务"],
] as const;
export const statusLabels = {
  success: "已读取出口",
  timeout: "检测超时",
  "http-error": "接口响应异常",
  unreadable: "未返回有效 IP",
  "network-error": "请求失败或跨域受限",
  unsupported: "暂不支持出口检测",
} as const;
export type ProbeStatus = keyof typeof statusLabels;
export type ProbeResult = {
  status: ProbeStatus;
  checkedAt: number;
  durationMs: number;
  geo?: Geo;
  httpStatus?: number;
};
export type SplitRow = Site & {
  id: string;
  target: string;
  result?: ProbeResult;
  geo?: Geo;
  pending: boolean;
  visible: boolean;
  geoPending: boolean;
};
export type SnapshotEntry = {
  target: string;
  status: ProbeStatus;
  ip?: string;
  countryCode?: string;
  checkedAt: number;
};
export type Snapshot = {
  version: 1;
  savedAt: number;
  entries: Record<string, SnapshotEntry>;
};
export type Expectation = { kind: "ip" | "country"; value: string };
export type Expectations = Record<string, Expectation>;

export function probeTarget(site: Site) {
  if (site.method === "unsupported") return "";
  if (site.method === "cftrace" && site.domain)
    return `https://${site.domain}/cdn-cgi/trace`;
  return (
    site.url ??
    "https://necaptcha.nosdn.127.net/ab7f4275c1744aa28e0a8f3a1c58c532.png"
  );
}
export function inCategory(site: Site, category: string) {
  return (
    category === "all" ||
    site.type === category ||
    !!site.extra?.includes(category)
  );
}
export function createSnapshot(rows: SplitRow[], now = Date.now()): Snapshot {
  return {
    version: 1,
    savedAt: now,
    entries: Object.fromEntries(
      rows
        .filter((row) => row.result && !row.pending)
        .map((row) => [
          row.id,
          {
            target: row.target,
            status: row.result!.status,
            ip: row.geo?.ip,
            countryCode: row.geo?.country_code,
            checkedAt: row.result!.checkedAt,
          },
        ]),
    ),
  };
}
export function parseSnapshot(raw: string | null): Snapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 ||
      !Number.isFinite(value.savedAt) ||
      !value.entries ||
      typeof value.entries !== "object" ||
      Array.isArray(value.entries)
    )
      return null;
    const entries: Record<string, SnapshotEntry> = {};
    for (const [id, item] of Object.entries(value.entries)) {
      const entry = item as SnapshotEntry;
      if (
        !entry ||
        typeof entry.target !== "string" ||
        !Object.hasOwn(statusLabels, entry.status) ||
        !Number.isFinite(entry.checkedAt)
      )
        return null;
      const ip = normalizeIp(entry.ip);
      if (entry.status === "success" && !ip) return null;
      entries[id] = {
        target: entry.target,
        status: entry.status,
        ip: entry.status === "success" ? ip : undefined,
        countryCode:
          typeof entry.countryCode === "string" &&
          /^[A-Z]{2}$/.test(entry.countryCode)
            ? entry.countryCode
            : undefined,
        checkedAt: entry.checkedAt,
      };
    }
    return { version: 1, savedAt: value.savedAt, entries };
  } catch {
    return null;
  }
}
export const changeLabels = {
  none: "未保存基准",
  pending: "等待本次结果",
  new: "基准中无此目标",
  same: "与基准一致",
  changed: "出口已变化",
  recovered: "已恢复读取",
  lost: "本次未读到出口",
  unavailable: "两次均未读到出口",
  unsupported: "不参与对比",
} as const;
export type Change = keyof typeof changeLabels;
export function compareSnapshot(
  row: SplitRow,
  snapshot: Snapshot | null,
): Change {
  if (row.method === "unsupported") return "unsupported";
  if (!snapshot) return "none";
  if (row.pending || !row.result) return "pending";
  const before = snapshot.entries[row.id];
  if (!before || before.target !== row.target) return "new";
  const success = row.result.status === "success";
  if (success && before.status === "success")
    return normalizeIp(row.geo?.ip) === normalizeIp(before.ip)
      ? "same"
      : "changed";
  if (success) return "recovered";
  return before.status === "success" ? "lost" : "unavailable";
}
export function validateExpectation(
  kind: string,
  value: string,
): Expectation | null {
  if (kind === "ip") {
    const ip = normalizeIp(value);
    return ip ? { kind, value: ip } : null;
  }
  const code = value.trim().toUpperCase();
  if (kind === "country" && /^[A-Z]{2}$/.test(code)) {
    // Reject unknown region codes without shipping a second country database.
    const name = new Intl.DisplayNames(["en"], {
      type: "region",
      fallback: "none",
    }).of(code);
    if (name && code !== "ZZ" && code !== "EU" && code !== "UN")
      return { kind, value: code };
  }
  return null;
}
export function parseExpectations(raw: string | null): Expectations {
  try {
    const data = JSON.parse(raw ?? "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data).flatMap(([id, value]) => {
        const rule = value as Expectation;
        const parsed =
          rule && typeof rule.value === "string"
            ? validateExpectation(rule.kind, rule.value)
            : null;
        return parsed ? [[id, parsed]] : [];
      }),
    );
  } catch {
    return {};
  }
}
export function matchExpectation(
  row: SplitRow,
  expectation?: Expectation,
): "unset" | "unknown" | "match" | "mismatch" {
  if (!expectation) return "unset";
  if (row.pending || row.result?.status !== "success") return "unknown";
  const observed =
    expectation.kind === "ip"
      ? normalizeIp(row.geo?.ip)
      : row.geo?.country_code?.toUpperCase();
  if (!observed) return "unknown";
  return observed === expectation.value ? "match" : "mismatch";
}
/** Different address families are independent paths, not evidence of a leak. */
export function compareAddresses(
  reference: string | undefined,
  observed: string | undefined,
) {
  const a = normalizeIp(reference),
    b = normalizeIp(observed);
  if (!a || !b) return "unknown";
  if (a.includes(":") !== b.includes(":")) return "different-family";
  return a === b ? "same" : "different";
}
