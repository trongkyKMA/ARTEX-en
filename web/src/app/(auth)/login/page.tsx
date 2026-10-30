"use client";

import { useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { AlertTriangle, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { auth } from "@/lib/auth";
import { tr } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [readToEnd, setReadToEnd] = useState(false);
  const termsBodyRef = useRef<HTMLDivElement>(null);

  // 滚动到条款底部（含无需滚动即可完整展示的情况）方可点击「同意」。
  function handleTermsScroll() {
    const el = termsBodyRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReadToEnd(true);
  }

  useEffect(() => {
    if (!termsOpen) return;
    // 打开时重置，并处理内容本就不足一屏、无法触发滚动的场景。
    setReadToEnd(false);
    const el = termsBodyRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 8) setReadToEnd(true);
  }, [termsOpen]);

  useEffect(() => {
    // 已登录直接进主界面（静态导出下无 middleware 代劳这层跳转）。
    const token = auth.getToken();
    if (token) {
      // localStorage 可能仍有凭据但 cookie 已丢失。先同步，再发起全新请求，
      // 避免服务端守卫或路由缓存把跳转送回仍处于 checking 状态的登录页。
      auth.setToken(token);
      window.location.replace("/function/tasks");
      return;
    }
    api
      .authStatus()
      .then(({ initialized }) => {
        if (!initialized) router.replace("/setup");
      })
      .catch(() => setError(tr("无法连接到后端服务", "Cannot reach the backend service")))
      .finally(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) {
      setError(tr("请先阅读并同意《使用须知》", "Read and accept the Terms of Use first"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { token } = await api.login("ARTEX", password);
      auth.setToken(token);
      window.location.replace("/function/tasks");
    } catch {
      setError(tr("用户名或密码错误", "Incorrect username or password"));
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center text-muted-foreground">
        {tr("正在检查登录状态…", "Checking login status…")}
      </div>
    );
  }

  return (
    <div className="flex h-dvh">
      {/* Left panel */}
      <div className="hidden flex-col items-center justify-center bg-primary p-12 text-center lg:flex lg:w-1/3">
        <div className="relative flex items-center justify-center">
          <div className="absolute size-80 rounded-full border border-primary-foreground/10" />
          <div className="absolute size-60 rounded-full border border-primary-foreground/15" />
          <div className="absolute size-40 rounded-full border border-primary-foreground/20" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="ARTEX" width={160} height={160} className="relative brightness-0 invert" />
        </div>
      </div>

      {/* Right panel */}
      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3">
        <div className="w-full max-w-md space-y-10 py-24 lg:py-32">
          <div className="space-y-4 text-center">
            <h2 className="text-2xl font-medium tracking-tight">{tr("登录", "Log in")}</h2>
            <p className="mx-auto max-w-xl text-muted-foreground">
              {tr("欢迎回来，请输入密码以继续使用 ARTEX", "Welcome back. Enter your password to continue to ARTEX")}
            </p>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">{tr("用户名", "Username")}</Label>
              <Input id="username" value="ARTEX" readOnly className="bg-muted text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{tr("密码", "Password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tr("请输入密码", "Enter password")}
                autoFocus
                autoComplete="current-password"
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="agree-terms"
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="agree-terms" className="text-sm font-normal leading-relaxed text-muted-foreground">
                {tr("我已阅读并同意", "I have read and accept the")}
                <button
                  type="button"
                  onClick={() => setTermsOpen(true)}
                  className="mx-0.5 font-medium text-primary underline-offset-4 hover:underline"
                >
                  {tr("《使用须知》", "Terms of Use")}
                </button>
              </Label>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !password || !agreed}>
              {loading ? tr("登录中...", "Logging in...") : tr("登录", "Log in")}
            </Button>
          </form>
        </div>
      </div>

      <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
        <DialogContent className="gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="flex-row items-center gap-3 border-b px-6 py-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div className="space-y-0.5">
              <DialogTitle className="text-base">
                {tr("ARTEX 使用须知与免责声明", "ARTEX Terms of Use and Disclaimer")}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {tr(
                  "版本 v1.0 · 生效日期 2026-09-18 · 请在登录前完整阅读以下全部条款",
                  "Version 1.0 · Effective 2026-09-18 · Read all of the terms below before logging in",
                )}
              </p>
            </div>
          </DialogHeader>

          <div
            ref={termsBodyRef}
            onScroll={handleTermsScroll}
            className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-muted-foreground"
          >
            <p className="rounded-lg border bg-muted/40 p-3 text-foreground/80">
              {tr(
                `本《使用须知与免责声明》（以下简称"本声明"）是您与 ARTEX 项目作者及贡献者之间就使用本软件所达成的约定。请您在使用前审慎阅读、充分理解各条款内容，特别是以粗体或色块标注的免责、责任限制及禁止性条款。`,
                `These Terms of Use and Disclaimer (the "Terms") are an agreement between you and the authors and contributors of the ARTEX project on the use of this software. Read them carefully before use and make sure you understand every clause, especially the disclaimers, limitations of liability and prohibitions shown in bold or highlighted.`,
              )}
              <span className="font-medium text-foreground">
                {" "}
                {tr(
                  "一旦您下载、安装、访问或以任何方式使用本软件，即视为您已阅读、理解并同意接受本声明的全部约束。",
                  "By downloading, installing, accessing or using this software in any way, you confirm that you have read, understood and agree to be bound by all of these Terms.",
                )}
              </span>
            </p>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  1
                </span>
                {tr("第一条 · 定义与开源许可", "Article 1 · Definitions and open-source license")}
              </h4>
              <p className="pl-7">
                {tr(
                  "本软件（ARTEX）是一款基于 GNU Affero General Public License v3.0（AGPL-3.0）发布的开源程序。您可依据该协议自由使用、复制、修改和分发本软件；但任何衍生作品（包括通过网络向第三方提供的在线服务）均须同样以 AGPL-3.0 协议开源并向使用者公开对应的完整源代码。AGPL-3.0 完整条款以随附的 LICENSE 文件为准。",
                  "This software (ARTEX) is open-source software released under the GNU Affero General Public License v3.0 (AGPL-3.0). Under that license you may freely use, copy, modify and distribute it; however, any derivative work (including an online service offered to third parties over a network) must also be released under AGPL-3.0 with its complete corresponding source code made available to its users. The full AGPL-3.0 terms are those in the accompanying LICENSE file.",
                )}
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  2
                </span>
                {tr("第二条 · 授权使用范围", "Article 2 · Permitted use")}
              </h4>
              <p className="pl-7">
                {tr(
                  "本软件仅供个人学习、代码研究、安全技术原理探讨，以及在您自行搭建的本地隔离环境中进行技术验证之用，适用于学习、学术研究、代码审阅等非攻击性、非破坏性用途。除本条明确许可的情形外，您不得将本软件用于任何其他目的。",
                  "This software is provided only for personal learning, code research, study of security techniques, and technical validation in an isolated local environment that you set up yourself; it is intended for non-offensive, non-destructive uses such as learning, academic research and code review. You may not use it for any purpose other than those expressly permitted in this article.",
                )}
              </p>
            </section>

            <section className="space-y-2">
              <h4 className="flex items-center gap-2 font-medium text-destructive">
                <span className="flex size-5 items-center justify-center rounded-md bg-destructive/10 text-xs font-semibold text-destructive">
                  3
                </span>
                <AlertTriangle className="size-4" />
                {tr("第三条 · 禁止行为", "Article 3 · Prohibited conduct")}
              </h4>
              <ul className="ml-7 list-decimal space-y-1.5 rounded-lg border border-destructive/20 bg-destructive/5 p-3 pl-8 text-foreground/80 marker:text-destructive/70">
                <li>
                  {tr(
                    "严禁对任何网站、线上服务、他人或第三方所有的联网系统发起扫描、探测、利用或攻击（无论是否已获得授权、是否为您自有资产）；",
                    "Do not scan, probe, exploit or attack any website, online service, or networked system owned by others or by third parties (whether or not you are authorized, and whether or not it is your own asset);",
                  )}
                </li>
                <li>
                  {tr(
                    "严禁将本软件用于任何实际的渗透测试、攻防对抗、红蓝演练或生产环境；",
                    "Do not use this software for any real penetration test, attack-defense exercise, red/blue team drill, or in a production environment;",
                  )}
                </li>
                <li>
                  {tr(
                    "严禁将本软件用于非法入侵、数据窃取、勒索、拒绝服务（DoS/DDoS）或任何破坏性、犯罪性活动；",
                    "Do not use this software for unauthorized intrusion, data theft, extortion, denial of service (DoS/DDoS), or any destructive or criminal activity;",
                  )}
                </li>
                <li>
                  {tr(
                    "严禁移除、篡改或规避本软件及其输出中的任何版权、许可或安全提示信息；",
                    "Do not remove, alter or circumvent any copyright, license or safety notice in this software or its output;",
                  )}
                </li>
                <li>
                  {tr(
                    "严禁从事任何违反您所在国家或地区法律、法规及监管规定的行为。",
                    "Do not engage in any conduct that violates the laws, regulations or regulatory requirements of your country or region.",
                  )}
                </li>
              </ul>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  4
                </span>
                {tr("第四条 · 知识产权", "Article 4 · Intellectual property")}
              </h4>
              <p className="pl-7">
                {tr(
                  "本软件的著作权及相关知识产权归项目作者及贡献者所有，并在 AGPL-3.0 协议约定的范围内向您授予相应权利。除该协议明确授予的权利外，本声明未以明示或默示方式授予您任何其他权利。",
                  "The copyright and related intellectual property in this software belong to the project authors and contributors, who grant you rights within the scope of AGPL-3.0. Apart from the rights expressly granted by that license, these Terms grant you no other rights, express or implied.",
                )}
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  5
                </span>
                {tr("第五条 · 数据与隐私", "Article 5 · Data and privacy")}
              </h4>
              <p className="pl-7">
                {tr(
                  "本软件为可自行部署的开源程序，作者不运营任何集中式服务、亦不会收集或上传您的使用数据。您在使用过程中产生、处理或接触的一切数据，均由您自行掌控并负责其合法性与安全性；因数据处理不当引发的任何后果由您自行承担。",
                  "This is self-hosted open-source software. The authors run no centralized service and do not collect or upload your usage data. You control all data you generate, process or access while using it and are responsible for its lawfulness and security; you bear any consequences of mishandling it.",
                )}
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  6
                </span>
                {tr("第六条 · 合规与法律责任", "Article 6 · Compliance and legal liability")}
              </h4>
              <p className="pl-7">
                {tr(
                  "您应自行遵守所在国家或地区关于网络安全、数据安全与个人信息保护、计算机犯罪等方面的全部法律法规（在中国大陆包括但不限于《网络安全法》《数据安全法》《个人信息保护法》及相关司法解释）。",
                  "You must comply with all laws and regulations of your country or region on cybersecurity, data security, personal information protection, computer crime and related matters (in mainland China this includes, without limitation, the Cybersecurity Law, the Data Security Law, the Personal Information Protection Law and related judicial interpretations).",
                )}
                <span className="font-medium text-foreground">
                  {" "}
                  {tr(
                    "因您违反上述法律法规或本声明约定而产生的一切法律责任与后果，均由您本人独立承担，与本软件作者及贡献者无关。",
                    "You alone bear all legal liability and consequences arising from your violation of those laws or of these Terms; the authors and contributors of this software bear none.",
                  )}
                </span>
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  7
                </span>
                {tr("第七条 · 免责声明与责任限制", "Article 7 · Disclaimer and limitation of liability")}
              </h4>
              <p className="pl-7">
                {tr(
                  `本软件按"现状（AS IS）"与"现有（AS AVAILABLE）"状态提供，不附带任何明示或默示的担保，包括但不限于对适销性、特定用途适用性、准确性及不侵权的担保。在适用法律允许的最大范围内，本软件作者及贡献者不对因使用或无法使用本软件（无论使用方式是否得当）而导致的任何直接、间接、偶然、特殊或后果性损失承担责任，包括但不限于数据丢失、系统损坏、业务中断、利润损失或法律纠纷。`,
                  `This software is provided "AS IS" and "AS AVAILABLE", without warranty of any kind, express or implied, including without limitation warranties of merchantability, fitness for a particular purpose, accuracy and non-infringement. To the maximum extent permitted by applicable law, the authors and contributors are not liable for any direct, indirect, incidental, special or consequential loss arising from the use of or inability to use this software (whether or not it was used properly), including without limitation data loss, system damage, business interruption, lost profits or legal disputes.`,
                )}
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  8
                </span>
                {tr("第八条 · 条款变更与最终解释", "Article 8 · Changes and final interpretation")}
              </h4>
              <p className="pl-7">
                {tr(
                  "作者有权根据法律法规或项目发展需要不时更新本声明，更新后的版本将随项目发布并自公布之日起生效；您继续使用本软件即视为接受修订后的条款。在法律允许的范围内，本声明的最终解释权归项目作者所有。若本声明任一条款被认定为无效，不影响其余条款的效力。",
                  "The authors may update these Terms from time to time as laws or the project require; an updated version is published with the project and takes effect on publication. Continuing to use this software means you accept the revised Terms. To the extent permitted by law, the project authors have final authority to interpret these Terms. If any clause is held invalid, the remaining clauses stay in effect.",
                )}
              </p>
            </section>
          </div>

          <DialogFooter className="mx-0 mb-0 flex-col items-stretch gap-2 rounded-b-xl px-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {readToEnd
                ? tr("您已浏览全部条款", "You have read all of the terms")
                : tr("请将条款滚动至底部后再确认", "Scroll to the end of the terms to accept")}
            </p>
            <DialogClose asChild>
              <Button
                type="button"
                disabled={!readToEnd}
                onClick={() => {
                  setAgreed(true);
                  setError("");
                }}
              >
                {tr("我已阅读并同意全部条款", "I have read and accept all terms")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
