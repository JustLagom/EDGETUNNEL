-----

# 🛡️ Titanium-V Core (TitanStallion Evolution)

> **The Next-Gen Serverless Proxy Solution on Cloudflare Workers**
> **下一代高可用、隐蔽式 Serverless 代理核心**

  

**Titanium-V Core** 是基于 Cloudflare Workers 运行的轻量级、高性能 VLESS 代理脚本。它不仅仅是一个简单的转发器，更内置了 **ReactionMax** 高可用引擎、智能伪装机制以及图形化的配置生成面板。

-----

## 🌟 核心优势 (Key Features)

Titanium-V Core 旨在解决传统 Worker 脚本“连接不稳定”、“容易被探测”和“配置繁琐”的三大痛点。

  * **🕵️ 极致隐蔽 (Stealth Mode)**
      * **智能分流**：直接访问域名显示**伪装的英文技术博客 (TechNote)**，完美通过主动探测。
      * **隐藏入口**：只有在 URL 后附加正确的 `/密钥` 路径，才能进入控制面板（例如 `https://domain.com/abc`）。
  * **⚡ ReactionMax 高可用引擎**
      * **自动重连**：内置指数退避重连算法，应对网络波动。
      * **连接保活**：主动心跳机制与流量吞吐量监测，防止连接“假死”。
      * **内存优化 (v4.0)**：自动清理过期会话，防止 Worker 内存溢出。
  * **🛠️ 全能配置面板**
      * **一键生成**：内置 Web UI，自动识别当前 Host，一键生成 VLESS (v2rayN/Nekobox) 和 Clash / Meta YAML 配置。
      * **灵活策略**：支持自定义优选 IP 地址、集成 SOCKS5 前置代理。

-----

## 📊 性能对比 (Comparison)

为什么选择 Titanium-V Core 而不是普通的 Worker 脚本？

| 特性 (Feature) | 🛡️ Titanium-V Core | ❌ 普通 Worker 脚本 |
| :--- | :--- | :--- |
| **稳定性** | **ReactionMax 引擎** (心跳/重连/健康检查) | 依赖 CF 原生连接，易断流，无重连机制 |
| **伪装能力** | **高** (静态博客伪装 + 路径验证) | **低** (通常返回 404 或纯文本，易识别) |
| **配置难度** | **极低** (Web UI 自动生成订阅链接) | **高** (需手动拼接 JSON/UUID，易出错) |
| **抗封锁** | **强** (支持自定义优选 IP/CDN) | **弱** (通常使用默认 Workers 域名) |
| **扩展性** | 支持 SOCKS5 前置、自定义反代 IP | 功能单一，仅支持直连 |
| **内存管理** | 自动清理缓存 (v4.0+) | 无管理，长时间运行可能 OOM 重启 |

-----

## 🚀 部署指南 (Deployment)

### 1\. 准备工作

  * 一个 Cloudflare 账号。
  * 一个托管在 Cloudflare 上的域名（**强烈建议**，1.用于防止默认域名流量被盗刷；2.默认worker域名已被墙）。

### 2\. 部署步骤

1.  登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2.  进入 **Workers & Pages** -\> **Create Application** -\> **Create Worker**。
3.  点击 **Deploy** (先部署个空壳)，然后点击 **Edit code**。
4.  **复制本项目 `worker.js` 的完整代码**，覆盖编辑器中的默认代码。
5.  **修改配置 (关键步骤)**：
    在代码顶部找到 `全局配置` 区域，修改 `密钥`：
    ```javascript
    const 全局配置 = {
        密钥: "此处设置你的密码", // 例如 "mysecret123"
        // ... 其他配置保持默认即可
    };
    ```
6.  点击右上角 **Deploy** 保存并部署。

### 3\. (关键优化) 防止偷跑请求数

Cloudflare Worker 免费版每天有 10 万次请求限制。互联网上存在大量扫描器，即使无法破解您的密码，扫描默认的 `*.workers.dev` 域名也会消耗您的请求配额。

**建议执行以下操作：**

1.  在 Worker 的 **Settings** -\> **Triggers** -\> **Custom Domains** 中，绑定您的自定义二级域名（例如 `vless.yourdomain.com`）。
2.  在下方的 **Routes** 区域，找到默认的 `xxx.workers.dev` 路由。
3.  点击 **Disable Route** (禁用路由)。
    > **注意**：这样做之后，您只能通过自定义域名访问，彻底杜绝针对默认域名的扫描攻击。

-----

## 📖 如何使用

假设您绑定的域名是 `vless.yourdomain.com`，您设置的密钥是 `abc`：

  * **伪装访问**：浏览器打开 `https://vless.yourdomain.com/`
    👉 **结果**：显示 "TechNote" 技术博客，看起来像个普通网站，安全无忧。
  * **管理面板**：浏览器打开 `https://vless.yourdomain.com/abc`
    👉 **结果**：进入 Titanium-V 配置面板，设置优选 IP 并生成订阅。

-----

## ⚠️ 使用注意事项 (Must Read)

### 1\. 关于地址 (Address) 与优选 IP

在配置面板中，**“地址 (Address)”** 栏默认为 `www.shopify.com`。

  * **原理**：这是利用 CDN 的 SNI 分流特性。`www.shopify.com` 是 Cloudflare 的客户，我们可以利用它的 IP 作为入口，但 SNI (Server Name Indication) 依然指向您的 Worker 域名。
  * **注意**：如果您的网络环境无法直接连接 `www.shopify.com`（被阻断），请务必将其修改为**您本地能连通的 Cloudflare 优选 IP** 或其他未被阻断的 Cloudflare 节点域名（如 `ip.sb` 等）。

### 2\. UDP 流量支持

Cloudflare Workers 的 `connect()` API 主要基于 TCP。

  * 虽然 VLESS 协议支持 UDP，代码也做了转发处理，但在 Worker 环境下，**UDP 性能可能不如 TCP**，且可能面临连接回落。建议主要用于网页浏览、流媒体等 TCP 流量。

### 3\. 端口限制

Cloudflare Workers 仅支持特定的 HTTPS 端口。通常情况下，生成的订阅链接默认使用 **443** 端口。请勿尝试连接非 CF 支持的端口。

-----

## ⚖️ 免责声明 (Disclaimer)

本项目仅供技术研究与学习交流使用。

  * 请勿将本项目用于任何违反当地法律法规的用途。
  * 使用者需自行承担因使用本项目而产生的任何后果。
  * 项目作者不提供任何形式的保证。

-----

**Made with ❤️ by Google-Gemini**
