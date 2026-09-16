import { useEffect } from "react";
import { t } from "@/i18n";
import { SplitDashboard } from "@/views/home/split-dashboard";

export default function ExitsPage() {
  useEffect(() => {
    document.title = t("分流出口 - IPCheckKit");
  }, []);
  return <SplitDashboard />;
}
