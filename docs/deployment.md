# IPCheckKit · Cloudflare 部署

生产站点：`https://ipcheckkit.com`。Worker：`ipcheckkit`。
仓库：`https://github.com/xianjixiance/one-ip`，生产分支：`main`。

前端静态资源和 `/api/*` 全部由 Cloudflare Workers + Static Assets 托管，无需独立服务器或数据库。IP 数据、全球 Ping 和厂商状态仍来自项目原有第三方服务。

## 域名与账户

在部署使用的 Cloudflare 账户中添加 `ipcheckkit.com`，完成 DNS 接入，确认域名状态为 Active。若在其他注册商购买，需要将 Nameservers 改成 Cloudflare 分配的值。

`wrangler.toml` 已配置根域名 Custom Domain。部署时 Cloudflare 会创建相应 DNS 记录并签发证书，不需要手工添加指向 `workers.dev` 的 CNAME。若根域名已有其他网站记录，应先核实用途再调整。

## 本地验证与首次部署

使用 Node.js 24 或更新版本、pnpm 10.32.1：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm deploy
```

存在多个 Cloudflare 账户时，明确选择拥有 `ipcheckkit.com` 的账户，或通过 `CLOUDFLARE_ACCOUNT_ID` 指定该账户。不要提交 API Token 或其他凭证。

本地开发使用 `pnpm worker:dev`，访问 `http://127.0.0.1:8787`。本地 Worker 无法取得生产环境的真实访客 IP，查询健康度时需传入 `ip`。

## Cloudflare 自动部署

在 Workers & Pages 中导入 GitHub 仓库 `xianjixiance/one-ip`：

| 配置        | 值                                     |
| ----------- | -------------------------------------- |
| Worker 名称 | `ipcheckkit`                           |
| 生产分支    | `main`                                 |
| 根目录      | 仓库根目录                             |
| Node.js     | `24`                                   |
| pnpm        | `10.32.1`                              |
| 构建命令    | `pnpm build && pnpm test && pnpm lint` |
| 部署命令    | `pnpm deploy`                          |

首次由 CLI 部署后，可在已有 Worker 中连接 Git 构建。使用 Workers Builds 时，保持 GitHub Actions 的 `ENABLE_CF_DEPLOY` 未设置或为 `false`，避免两套系统重复发布。GitHub Actions 仍负责构建、测试和 lint。

## 上线检查

- 首页、网络检测、浏览器检测、AI 检测及 API 文档可以直接打开并刷新。
- HTTPS 证书有效，页头和浏览器标题显示 IPCheckKit。
- `curl -fsS 'https://ipcheckkit.com/api/ip/health?ip=1.1.1.1'` 返回指定 IP 的 JSON；第三方限流或故障须按实际响应处理。
- `curl -fsS 'https://ipcheckkit.com/api/ip/health?format=text'` 展示当前请求出口的信息，首行为 `IPCheckKit — IP health`。
- `/worker/index.js` 返回 404，后端源码不作为静态资源提供。

## 可选配置

基础功能不需要应用 API Key。要启用 Turnstile / reCAPTCHA 验证体验，再创建对应组件，并在 Worker Secrets 中添加 README 列出的配置，允许域名填写 `ipcheckkit.com`。

站点反馈入口使用本 Fork 的 GitHub Issues，未假设 `ipcheckkit.com` 已配置邮箱。品牌与站点链接集中在 `src/lib/site.ts`；原项目与第三方许可证保留在仓库中。

参考：[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。
