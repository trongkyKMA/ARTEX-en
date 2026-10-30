import { tr } from "@/lib/i18n";

import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "ARTEX",
  version: packageJson.version,
  copyright: `© ${currentYear}, ARTEX.`,
  meta: {
    title: tr("ARTEX — 自主渗透测试控制台", "ARTEX — Autonomous Penetration Testing Console"),
    description: tr(
      "LLM 驱动的自主渗透测试系统控制台",
      "Console for an LLM-driven autonomous penetration testing system",
    ),
  },
};
