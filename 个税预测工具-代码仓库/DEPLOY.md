# 部署说明

本工具是**纯静态站点**：只有 HTML / CSS / JS 三类文件，无需 Node / Python 运行时，无需数据库，无需环境变量。任何能托管静态文件的地方都可以部署。

```
部署目录 = 仓库根目录（index.html + assets/）
```

> `tests/`、`scripts/`、`docs/`、`*.md` 与部署无关，可以先剔除；也可以原样上传，不影响运行。

---

## 部署方式一：WorkBuddy CloudStudio（本项目实际使用）

由内置部署能力自动完成「创建工作区 → 上传文件 → 启动静态服务 → 生成分享链接」，无需手工操作。

**注意访问方式**：生成的链接带会话鉴权。直接转发给未登录的人访问会看到「链接不完整」提示页。完整分享请到 **设置 - 数据管理 - 我发布的应用** 中复制**带访问参数的完整链接**。

**更新方式**：修改本地文件后重新部署一次即可覆盖。

---

## 部署方式二：Nginx（自有服务器）

```nginx
server {
    listen 80;
    server_name tax.example.com;
    root /var/www/tax-forecast;
    index index-standalone.html;

    charset utf-8;

    # 单页应用；入口为单文件版（若你恢复了模块化 index.html，把下面两处改回 index.html）
    location / {
        try_files $uri $uri/ /index-standalone.html;
    }

    # 静态资源长缓存（文件名未做 hash 时建议改为 1h，避免更新不生效）
    location ~* \.(css|js)$ {
        expires 1h;
        add_header Cache-Control "public, max-age=3600, must-revalidate";
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1k;
}
```

```bash
# 上传
rsync -avz --delete ./ user@server:/var/www/tax-forecast/
sudo nginx -t && sudo systemctl reload nginx
```

**HTTPS**：若要在页面上接入 AI 接口，必须使用 HTTPS，否则浏览器会以混合内容拦截非安全请求。

---

## 部署方式三：GitHub Pages

1. 把仓库推到 GitHub
2. `Settings → Pages → Source` 选择 `Deploy from a branch`，分支 `main`，目录 `/ (root)`
3. 等待 Actions 构建，访问 `https://<用户名>.github.io/<仓库名>/`

如需自动发布，可加一条 workflow：

```yaml
name: Deploy to Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - uses: actions/deploy-pages@v4
```

> 本项目所有资源路径都是**相对路径**（`assets/js/...`），所以部署在子路径（如 `/tax-forecast/`）下也能正常工作，无需改配置。

---

## 部署方式四：Vercel / Netlify / 对象存储

| 平台 | 配置 |
| --- | --- |
| **Vercel** | 导入仓库 → Framework Preset 选 `Other` → Build Command 留空 → Output Directory 填 `.` |
| **Netlify** | 拖拽目录到控制台即可；或 `netlify deploy --prod --dir .` |
| **阿里云 OSS / 腾讯云 COS** | 上传后开启「静态网站托管」，默认首页设为 `index.html`，MIME 要正确识别 `.js` 为 `text/javascript` |
| **Cloudflare Pages** | Build command 留空，Build output directory 填 `/` |

---

## 部署后自检清单

部署完成后，按顺序验证这 8 项（约 2 分钟）：

| # | 检查项 | 期望 |
| --- | --- | --- |
| 1 | 打开首页 | 显示「个税预测 2027」，左侧表单、右侧结果均有内容 |
| 2 | 结果数值 | 主数字显示 `¥15,870`（默认示例参数：月薪 2 万 / 年终奖 6 万 / 公积金 12%） |
| 3 | 样式是否加载 | 卡片有圆角与阴影、主视觉为深蓝渐变；若为白底裸样式 → CSS 路径 404 |
| 4 | 交互是否生效 | 改月薪为 40000，右侧数字实时变化；若无变化 → JS 路径 404 或报错 |
| 5 | 专项附加扣除 | 打开「子女教育」开关，下方出现选项，右侧金额变为 ¥2,000 |
| 6 | 图表 | 「月度到手现金流」渲染出 12 根柱，悬停显示明细 |
| 7 | AI 助手 | 点击右下角气泡展开，发送「年终奖怎么发最省税」，返回带金额的回答 |
| 8 | 分享链接 | 点「分享方案」，在新标签打开该链接，表单参数应完全还原 |

浏览器控制台（F12）不应出现红色报错。常见问题：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 样式/脚本 404 | 部署到了子目录但用了绝对路径 | 本项目已用相对路径，检查是否被 CDN 重写 |
| 页面能开但数字不刷新 | `tax-engine.js` 未加载或加载顺序错误 | 确认三个 script 顺序：tax-engine → app → chat |
| 中文乱码 | 服务器未声明 charset | 响应头加 `Content-Type: text/html; charset=utf-8` |
| 更新后仍是旧版 | 浏览器缓存 | 强刷 Ctrl+F5，或调整 `Cache-Control` |
| AI 助手报「网络请求失败」 | 接口未放行 CORS 或页面为 http | 换支持浏览器直连的服务商，或启用 HTTPS |

---

## 版本回滚

纯静态站点回滚即「换回上一版文件」：

```bash
git checkout <上一个可用 commit> -- .
# 或
rsync -avz --delete ./release/个税预测工具-v1.0.0/ user@server:/var/www/tax-forecast/
```

由于不上传、不落库任何用户数据，回滚无数据迁移风险。
