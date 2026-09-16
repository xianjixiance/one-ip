import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { t } from "@/i18n";
import {
  categories,
  inCategory,
  validateExpectation,
  type Expectations,
  type SplitRow,
} from "./split-model";

export const selectClass =
  "h-9 max-w-full min-w-0 rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
export function ExpectationEditor({
  rows,
  scope: initialScope,
  rules,
  onSave,
  onClose,
}: {
  rows: SplitRow[];
  scope: string;
  rules: Expectations;
  onSave: (rules: Expectations) => void;
  onClose: () => void;
}) {
  const initial = initialScope.startsWith("site:")
    ? rules[initialScope.slice(5)]
    : undefined;
  const [scope, setScope] = useState(initialScope);
  const [kind, setKind] = useState<"ip" | "country">(
    initial?.kind ?? "country",
  );
  const [value, setValue] = useState(initial?.value ?? "");
  const [error, setError] = useState("");
  const targets = rows.filter(
    (row) =>
      row.method !== "unsupported" &&
      (scope.startsWith("site:")
        ? row.id === scope.slice(5)
        : inCategory(row, scope.slice(9))),
  );
  function apply(clear: boolean) {
    const rule = clear ? null : validateExpectation(kind, value);
    if (!clear && !rule) {
      setError(
        t(
          kind === "ip"
            ? "请输入完整有效的 IPv4 或 IPv6 地址"
            : "请输入有效的两位国家或地区代码，如 CN、SG、JP",
        ),
      );
      return;
    }
    const next = { ...rules };
    for (const row of targets) {
      if (rule) next[row.id] = rule;
      else delete next[row.id];
    }
    onSave(next);
    onClose();
  }
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("设置预期出口")}
      description={t(
        "按你的分流规则填写。批量设置会覆盖所选站点原有的预期；不会修改代理配置。",
      )}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          apply(false);
        }}
      >
        <label className="grid gap-2 text-sm">
          {t("应用到")}
          <select
            className={selectClass}
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setError("");
            }}
          >
            <optgroup label={t("站点分类")}>
              {categories.map(([id, label]) => (
                <option key={id} value={`category:${id}`}>
                  {t(label)}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("单个网站")}>
              {rows
                .filter((row) => row.method !== "unsupported")
                .map((row) => (
                  <option key={row.id} value={`site:${row.id}`}>
                    {t(row.name)}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          {t("匹配条件")}
          <select
            className={selectClass}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as "ip" | "country");
              setValue("");
              setError("");
            }}
          >
            <option value="country">{t("国家或地区")}</option>
            <option value="ip">{t("指定出口 IP")}</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          {t(kind === "ip" ? "预期 IP 地址" : "国家或地区代码")}
          <Input
            value={value}
            placeholder={kind === "ip" ? "203.0.113.1" : "CN / SG / JP / US"}
            onChange={(event) => {
              setValue(event.target.value);
              setError("");
            }}
            aria-invalid={!!error}
            aria-describedby={error ? "expectation-error" : undefined}
            autoComplete="off"
            maxLength={kind === "ip" ? 45 : 2}
          />
        </label>
        {error && (
          <p
            id="expectation-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t(
            "将应用到 {0} 个支持检测的站点。地区判断依赖 IP 数据源，未读到结果时保持未知。",
            [targets.length],
          )}
        </p>
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => apply(true)}
            disabled={!targets.length}
          >
            {t("清除所选预期")}
          </Button>
          <Button type="submit" disabled={!targets.length}>
            {t("保存预期")}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
