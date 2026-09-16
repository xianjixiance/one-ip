import { lazy, Suspense, useState } from "react";
import { CountryFlag } from "@/components/country-flag";
import { SiteLogo } from "@/components/site-logo";
import { IpText, PrivacyToggle } from "@/components/toolkit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { t } from "@/i18n";
import { maskedIp } from "@/lib/network";
import { hideIpAtom } from "@/store/privacy";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import { ExpectationEditor, selectClass } from "./split-expectations";
import {
  categories,
  changeLabels,
  compareSnapshot,
  createSnapshot,
  inCategory,
  matchExpectation,
  parseExpectations,
  parseSnapshot,
  statusLabels,
  type Expectations,
  type Snapshot,
  type SplitRow,
} from "./split-model";
import { SplitNetworkChecks } from "./split-network-checks";
import { useSplitProbes } from "./use-split-probes";

const ExitMap = lazy(() => import("./exit-map"));
const baselineKey = "ipcheckkit:split-baseline:v1";
const rulesKey = "ipcheckkit:split-expectations:v1";
function readLocal(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast.warning(t("浏览器存储不可用，设置仅在本次页面停留期间保留。"));
    return false;
  }
}
const stamp = (time: number) =>
  new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
function host(row: SplitRow) {
  return row.target ? new URL(row.target).hostname : (row.domain ?? row.name);
}
const terminalFailure = (row: SplitRow) =>
  !!row.result &&
  !row.pending &&
  !["success", "unsupported"].includes(row.result.status);
function State({ row }: { row: SplitRow }) {
  const text = row.pending
    ? "检测中…"
    : row.result
      ? statusLabels[row.result.status]
      : "等待检测";
  const style =
    row.pending || !row.result || row.result.status === "unsupported"
      ? "text-muted-foreground"
      : row.result.status === "success"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-amber-700 dark:text-amber-400";
  return (
    <div>
      <span className={`text-xs ${style}`}>
        {t(text)}
        {row.result?.httpStatus && !row.pending
          ? ` · HTTP ${row.result.httpStatus}`
          : ""}
      </span>
      {row.result && !row.pending && row.method !== "unsupported" && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {stamp(row.result.checkedAt)} · {row.result.durationMs} ms
        </div>
      )}
    </div>
  );
}
function Location({ row }: { row: SplitRow }) {
  if (row.pending || !row.geo)
    return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <CountryFlag code={row.geo.country_code} />
        <span className="break-words">
          {row.geo.country ??
            row.geo.country_code ??
            t(row.geoPending ? "查询中…" : "归属信息未知")}
          {row.geo.city && row.geo.city !== row.geo.country
            ? ` · ${row.geo.city}`
            : ""}
        </span>
      </div>
      {row.geo.isp && (
        <div className="mt-1 text-xs text-muted-foreground">
          {row.geo.isp}
          {row.geo.asn ? ` · AS${String(row.geo.asn).replace(/^AS/i, "")}` : ""}
        </div>
      )}
    </div>
  );
}
function Comparison({
  row,
  baseline,
  rules,
}: {
  row: SplitRow;
  baseline: Snapshot | null;
  rules: Expectations;
}) {
  const change = compareSnapshot(row, baseline);
  const match = matchExpectation(row, rules[row.id]);
  return (
    <div className="space-y-1 text-xs">
      {baseline && (
        <div
          className={
            ["changed", "lost", "recovered"].includes(change)
              ? "font-medium text-amber-700 dark:text-amber-400"
              : "text-muted-foreground"
          }
        >
          {t(changeLabels[change])}
        </div>
      )}
      {baseline && change === "changed" && baseline.entries[row.id]?.ip && (
        <div className="flex flex-wrap gap-1 text-muted-foreground">
          {t("原出口")} <IpText ip={baseline.entries[row.id].ip} />
        </div>
      )}
      {match !== "unset" && (
        <div
          className={
            match === "mismatch"
              ? "font-medium text-amber-700 dark:text-amber-400"
              : match === "match"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground"
          }
        >
          {t(
            {
              match: "符合预期",
              mismatch: "与预期不符",
              unknown: "预期匹配未知",
            }[match],
          )}
          <span className="ml-1">
            ·{" "}
            {rules[row.id].kind === "ip" ? (
              <IpText ip={rules[row.id].value} />
            ) : (
              rules[row.id].value
            )}
          </span>
        </div>
      )}
      {!baseline && match === "unset" && (
        <span className="text-muted-foreground">{t("未设置对照")}</span>
      )}
    </div>
  );
}

export function SplitDashboard() {
  const { rows, busy, completed, retry, stop } = useSplitProbes();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"list" | "groups" | "map">("list");
  const [baseline, setBaseline] = useState(() =>
    parseSnapshot(readLocal(baselineKey)),
  );
  const [rules, setRules] = useState(() =>
    parseExpectations(readLocal(rulesKey)),
  );
  const [ruleScope, setRuleScope] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const hidden = useAtomValue(hideIpAtom);
  const failures = rows.filter(terminalFailure);
  const successes = rows.filter(
    (row) => !row.pending && row.result?.status === "success",
  );
  const supported = rows.filter((row) => row.method !== "unsupported");
  const changes = rows.filter((row) =>
    ["changed", "lost", "recovered"].includes(compareSnapshot(row, baseline)),
  );
  const mismatches = rows.filter(
    (row) => matchExpectation(row, rules[row.id]) === "mismatch",
  );
  const shown = rows.filter((row) => {
    if (!inCategory(row, category)) return false;
    const query = search.trim().toLowerCase();
    if (
      query &&
      ![
        t(row.name),
        host(row),
        hidden ? undefined : row.geo?.ip,
        row.geo?.country,
        row.geo?.isp,
      ].some((value) => value?.toLowerCase().includes(query))
    )
      return false;
    if (filter === "failed") return terminalFailure(row);
    if (filter === "changed") return changes.includes(row);
    if (filter === "mismatch") return mismatches.includes(row);
    if (filter === "unsupported") return row.method === "unsupported";
    if (filter === "success")
      return !row.pending && row.result?.status === "success";
    return true;
  });
  const groups = new Map<string, SplitRow[]>();
  for (const row of shown) {
    const key = row.pending
      ? t("检测中…")
      : (row.geo?.ip ??
        t(row.result ? statusLabels[row.result.status] : "等待检测"));
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const detail = rows.find((row) => row.id === detailId);
  const readyToSave =
    !busy &&
    completed === rows.length &&
    successes.length > 0 &&
    !rows.some((row) => row.geoPending);
  function saveBaseline() {
    const snapshot = createSnapshot(rows);
    setBaseline(snapshot);
    if (writeLocal(baselineKey, snapshot))
      toast.success(
        t("基准已保存在此浏览器。修改分流规则后，重新检测即可对比。"),
      );
  }
  function clearBaseline() {
    setBaseline(null);
    writeLocal(baselineKey, null);
    if (filter === "changed") setFilter("all");
  }
  const actions = (row: SplitRow) => (
    <div className="flex flex-wrap gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={row.pending || row.method === "unsupported"}
        aria-label={t("重新检测 {0}", [t(row.name)])}
        onClick={() => void retry([row.id])}
      >
        {t("重测")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={row.method === "unsupported"}
        aria-label={t("设置 {0} 的预期出口", [t(row.name)])}
        onClick={() => {
          setDetailId(null);
          setRuleScope(`site:${row.id}`);
        }}
      >
        {t("预期")}
      </Button>
    </div>
  );
  const identity = (row: SplitRow) => (
    <div className="flex items-start gap-2">
      <SiteLogo src={row.icon} />
      <div className="min-w-0">
        <button
          className="text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => setDetailId(row.id)}
        >
          {t(row.name)}
        </button>
        <div className="mt-1 break-all text-[11px] text-muted-foreground">
          {host(row)}
        </div>
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {t("网站分流检测")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("逐站查看实际出口，比较规则调整前后的变化。")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrivacyToggle />
          {busy ? (
            <Button size="sm" variant="outline" onClick={() => void stop()}>
              {t("停止检测")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void retry()}>
              {t("全部重测")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !failures.length}
            onClick={() => void retry(failures.map((row) => row.id))}
          >
            {t("重测失败项")}
            {failures.length ? ` (${failures.length})` : ""}
          </Button>
        </div>
      </div>
      <div className="rounded-lg border bg-muted/20 px-4 py-3">
        <div
          className="flex flex-wrap gap-x-5 gap-y-2 text-xs"
          role="status"
          aria-live="polite"
        >
          <span>
            {t("已完成")}{" "}
            <strong className="tabular-nums">
              {completed}/{rows.length}
            </strong>
          </span>
          <span>
            {t("已读取出口")}{" "}
            <strong className="tabular-nums">
              {successes.length}/{supported.length}
            </strong>
          </span>
          <span>
            {t("本次未读到")} <strong>{failures.length}</strong>
          </span>
          <span>
            {t("暂不支持")} <strong>{rows.length - supported.length}</strong>
          </span>
          {baseline && (
            <span>
              {t("对比有变化")} <strong>{changes.length}</strong>
            </span>
          )}
          {Object.keys(rules).length > 0 && (
            <span>
              {t("与预期不符")} <strong>{mismatches.length}</strong>
            </span>
          )}
        </div>
        <div
          className="mt-3 h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={t("检测进度")}
          aria-valuemin={0}
          aria-valuemax={rows.length}
          aria-valuenow={completed}
        >
          <div
            className="h-full origin-left rounded-full bg-primary"
            style={{ transform: `scaleX(${completed / rows.length})` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {t(
            "读取成功表示取得该请求的出口，不代表直连、代理规则正确或服务已解锁；未读到 IP 也不等于网站无法访问。",
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
        <div className="min-w-0 text-xs">
          <p className="font-medium">
            {baseline
              ? t("基准保存于 {0}", [
                  new Date(baseline.savedAt).toLocaleString(),
                ])
              : t("先保存基准，再调整代理规则并重新检测。")}
          </p>
          <p className="mt-1 text-muted-foreground">
            {t(
              "基准和预期仅保存在此浏览器，不会上传；单站重测会保留其他站点的采样时间。",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!readyToSave}
            onClick={saveBaseline}
          >
            {t(baseline ? "更新基准" : "保存为基准")}
          </Button>
          {baseline && (
            <Button size="sm" variant="ghost" onClick={clearBaseline}>
              {t("清除基准")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRuleScope(`category:${category}`)}
          >
            {t("设置预期出口")}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-full sm:w-64"
          placeholder={t("搜索网站、域名、IP 或运营商")}
          aria-label={t("搜索分流站点")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className={`${selectClass} w-[calc(50%_-_0.25rem)] sm:w-auto`}
          aria-label={t("站点分类")}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {categories.map(([id, label]) => (
            <option key={id} value={id}>
              {t(label)} ({rows.filter((row) => inCategory(row, id)).length})
            </option>
          ))}
        </select>
        <select
          className={`${selectClass} w-[calc(50%_-_0.25rem)] sm:w-auto`}
          aria-label={t("筛选结果")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          {[
            ["all", "所有结果"],
            ["success", "已读取出口"],
            ["failed", "本次未读到"],
            ["changed", "对比有变化"],
            ["mismatch", "与预期不符"],
            ["unsupported", "暂不支持"],
          ].map(([id, label]) => (
            <option
              key={id}
              value={id}
              disabled={id === "changed" && !baseline}
            >
              {t(label)}
            </option>
          ))}
        </select>
        <div
          className="flex w-full justify-end gap-1 rounded-md bg-muted p-1 sm:ml-auto sm:w-auto"
          role="group"
          aria-label={t("结果视图")}
        >
          {(
            [
              ["list", "网站列表"],
              ["groups", "出口分组"],
              ["map", "出口地图"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={view === id ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {t(label)}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("显示 {0} 个站点", [shown.length])}
      </p>
      {!shown.length ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm">{t("没有符合筛选条件的站点")}</p>
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setCategory("all");
              setFilter("all");
            }}
          >
            {t("清除筛选")}
          </Button>
        </div>
      ) : (
        <>
          {view === "list" && (
            <>
              <div className="hidden overflow-x-auto rounded-lg border md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      {[
                        "网站 / 检测域名",
                        "出口 IP",
                        "地区 / 运营商",
                        "检测状态",
                        "基准 / 预期",
                        "操作",
                      ].map((label) => (
                        <th
                          key={label}
                          scope="col"
                          className="px-3 py-3 font-medium"
                        >
                          {t(label)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {shown.map((row) => (
                      <tr key={row.id} className="align-top hover:bg-muted/20">
                        <td className="max-w-56 px-3 py-3">{identity(row)}</td>
                        <td className="max-w-52 px-3 py-3 font-mono text-xs">
                          {row.pending ? (
                            <span
                              className="inline-block h-4 w-24 animate-pulse rounded bg-muted motion-reduce:animate-none"
                              aria-label={t("检测中…")}
                            />
                          ) : row.geo ? (
                            <IpText ip={row.geo.ip} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="max-w-56 px-3 py-3 text-xs">
                          <Location row={row} />
                        </td>
                        <td className="max-w-44 px-3 py-3">
                          <State row={row} />
                        </td>
                        <td className="max-w-52 px-3 py-3">
                          <Comparison
                            row={row}
                            baseline={baseline}
                            rules={rules}
                          />
                        </td>
                        <td className="px-2 py-2">{actions(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y rounded-lg border md:hidden">
                {shown.map((row) => (
                  <article key={row.id} className="space-y-3 p-3">
                    <div className="flex items-start justify-between gap-2">
                      {identity(row)}
                      {actions(row)}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 font-mono text-sm">
                        {row.pending ? (
                          t("检测中…")
                        ) : row.geo ? (
                          <IpText ip={row.geo.ip} />
                        ) : (
                          "—"
                        )}
                      </div>
                      <State row={row} />
                    </div>
                    <div className="text-xs">
                      <Location row={row} />
                    </div>
                    <Comparison row={row} baseline={baseline} rules={rules} />
                  </article>
                ))}
              </div>
            </>
          )}
          {view === "groups" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[...groups].map(([key, items]) => (
                <section className="min-w-0 rounded-lg border p-4" key={key}>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="min-w-0 text-sm font-medium">
                      {items[0].geo && !items[0].pending ? (
                        <IpText ip={key} />
                      ) : (
                        key
                      )}
                    </h2>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("{0} 个站点", [items.length])}
                    </span>
                  </div>
                  {items[0].geo && !items[0].pending && (
                    <div className="mt-2 text-xs">
                      <Location row={items[0]} />
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {items.map((row) => (
                      <button
                        key={row.id}
                        onClick={() => setDetailId(row.id)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {t(row.name)}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {view === "map" && (
            <Suspense fallback={<p role="status">{t("加载地图…")}</p>}>
              <ExitMap
                rows={shown.filter((row) => !row.pending && row.geo)}
                onSelect={setDetailId}
                mapOnly
              />
            </Suspense>
          )}
        </>
      )}
      <SplitNetworkChecks />
      {ruleScope !== null && (
        <ExpectationEditor
          rows={rows}
          scope={ruleScope}
          rules={rules}
          onClose={() => setRuleScope(null)}
          onSave={(next) => {
            setRules(next);
            if (writeLocal(rulesKey, next)) toast.success(t("预期出口已保存"));
          }}
        />
      )}
      <ResponsiveDialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        title={detail ? t(detail.name) : ""}
        description={t(
          "这里只代表下方检测地址的本次请求；同一服务的其他域名可能采用不同规则。",
        )}
      >
        {detail && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                {t("实际检测地址")}
              </p>
              {detail.target ? (
                <a
                  className="break-all underline underline-offset-4"
                  href={detail.target}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {detail.target}
                </a>
              ) : (
                <p>{t(detail.note ?? "暂不支持出口检测")}</p>
              )}
            </div>
            <State row={detail} />
            {detail.geo && !detail.pending && (
              <>
                <IpText ip={detail.geo.ip} />
                <Location row={detail} />
              </>
            )}
            <Comparison row={detail} baseline={baseline} rules={rules} />
            <p className="text-xs text-muted-foreground">
              {t(
                "耗时为本次 HTTP 探测总时间，包含连接与响应，不是 ICMP Ping。跨域或网络错误有时无法由浏览器进一步区分。",
              )}
            </p>
            {detail.result?.status === "timeout" && (
              <p className="text-xs text-muted-foreground">
                {t("本次请求超过 6 秒，可单独重测确认。")}
              </p>
            )}
            {baseline?.entries[detail.id]?.ip && !detail.pending && (
              <p className="text-xs text-muted-foreground">
                {t("基准出口")} ·{" "}
                {maskedIp(baseline.entries[detail.id].ip!, hidden)}
              </p>
            )}
            {actions(detail)}
          </div>
        )}
      </ResponsiveDialog>
    </div>
  );
}
