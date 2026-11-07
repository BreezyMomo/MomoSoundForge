> 2026-11-07 后续更新：文件格式已改为 [共享对象与完整依赖包](immutable-resource-architecture.md)。本页原有体积和浏览器测试记录属于此前分发验证，不能当作新格式验收；当前音频目录增加 `audio` 传输表。

# 网站与运行音频分开分发

## 当前状态与边界

已实现同源／独立地址两种构建、运行音库导出、网页及 AI 工具加载、文件校验和发布前跨域检查。**用户已选定 GitHub Pages 免费方案，尚未配置资源站、上传运行音库或切换线上网站。** 具体步骤见 [GitHub 音库 Pages](github-audio-pages.md)。默认配置仍使用完整同源网站；不设置地址就不会改变部署行为。

用户确认项目尚未发布：不要求兼容旧工程、旧站点或保留旧个人测试工程。本轮只保障当前内置资源及当前版本的保存、重开和导出；不为旧引用增加历史音库查找或回退机制。

这与 [内置资源维护流程](builtin-resource-maintenance.md) 的构建输入外置是两件事：

- 主 Git 仓库：代码、元数据、映射、来源授权、目录和输入锁文件。
- 资源 GitHub Releases：可恢复的原件、工作副本和构建输入压缩包。
- 独立静态服务／对象存储：**构建生成的** `.soundforge.bin`、`.recording.bin` 和授权文件，供浏览器按需读取。不需要第三个 Git 仓库，也不把大文件提交进 Git。

Releases 中的输入压缩包不是浏览器播放文件，不能直接把 Release 下载地址当作音库目录。用户的个人文件夹资源库不受此次分发调整影响。

## 制作与检查候选

先按维护流程恢复输入并完成普通构建：

```sh
npm run assets:sync
npm test
npm run build
node tools/check-static-site.mjs
npm run library:stage -- --output <一个尚不存在的目录>
```

暂存命令核对目录、文件字节数、SHA-256 和授权，再复制到新目录；拒绝覆盖现有目录，不上传。输出包括哈希音频文件、`licenses/` 和带目录哈希的 `manifest.json`。文件自身是应用 gzip 格式，上传时保持字节完全不变。

独立构建通过环境变量 `VITE_SOUND_LIBRARY_URL` 指定**直接包含这些文件的目录 URL**，例如 `https://<实际域名>/sound-library/<本次版本>/`。一份候选目录与一次网站构建配套使用，不合并历史音库。只接受 HTTPS；本地验收允许 HTTP loopback。地址不能包含账号、密码、查询参数或片段，不要放凭据。

PowerShell 本地示例（此地址仅用于本地双服务验证，不能发布）：

```powershell
$env:VITE_SOUND_LIBRARY_URL = 'http://127.0.0.1:5197/v1/'
try {
  npm run build -- --outDir test-results/distribution/site
  node tools/check-static-site.mjs --dir test-results/distribution/site --local-resources
} finally {
  Remove-Item Env:VITE_SOUND_LIBRARY_URL
}
```

`--local-resources` 只验本地候选，明确标记远程未验证，不能作为上线验收。独立构建不将音频二进制复制进网站；网站继续保留全部授权、编码器和可下载 AI 工具。`dist/sound-library/distribution.json` 告知 AI 工具当前分发位置，网页使用同次构建嵌入的地址。

## 真正上线的顺序

1. 选择支持 HTTPS、公开 GET 和 CORS 的静态服务；确认域名、容量、访问额度和费用。取得相应发布授权后再操作账户和上传。
2. 上传完整候选目录到本次版本路径，保留文件字节、授权和清单。不覆盖当前线上正在使用的目录；保存清单、上传位置和代码候选信息。
3. 配置跨域：允许网站来源；公开无凭据资源可以用 `Access-Control-Allow-Origin: *`。建议文件类型 `application/octet-stream`。**不要**给文件内置的 gzip 字节直接加 `Content-Encoding: gzip`；服务器可另做 HTTP 压缩，浏览器会还原为原文件字节。
4. 用正式地址构建，执行全量远程检查：

   ```sh
   node tools/check-static-site.mjs --origin https://breezymomo.github.io
   ```

   外置模式默认检查远端每一个音频与授权文件的实际字节数、哈希和 CORS，拒绝重定向，并限制单个响应读取量。四路下载覆盖全部文件，验收会产生约一份完整音库的流量。私有令牌不应是播放依赖。
5. 在浏览器验证普通音效、独立录音和完整钢琴，检查试听、编辑、保存、重开与导出。正式保存／分享收集完整依赖；测试断网后添加原先未演奏的琴键、改变力度和延长音符。首次收集内置录音需要联网。
6. 只有正式远端完整可用时，设置主仓库 Actions variable `SOUND_LIBRARY_URL` 为本次音库前缀。`SOUND_LIBRARY_ORIGIN` 默认为 `https://<仓库所有者>.github.io`，自定义网站域名时显式设置。地址是公开配置，不是 secret。
7. 在授权范围内提交／推送／发布。Pages 工作流用该变量构建，使用真实网站 origin 做远程检查；检查失败不会上传网站。不要在 CI 添加 `--local-resources` 绕过检查。

生产音频建议长缓存，正在使用的版本及哈希文件不可变。`distribution.json` 是网站部署信息，应跟随网站更新，避免永久缓存。每次更换音源都要先上传并验证新运行文件，再推进网站目录与分发地址；输入资源 Release 发布成功不等于运行音库已上线。

## 身份、保存与回退

- 地址属于部署配置，不进入工程、乐器、资源身份或撤销记录。音源仍按哈希、稳定 ID 和原有引用结构校验。
- 网页加载、独立录音和音符样本准备共享同一个有预算的加载器；更改地址不修改解码／渲染结果。
- AI 下载工具读取网站的 `distribution.json`；缺失或错误就明确失败，不兼容旧站点。使用与当前网站一起生成的 AI 工具。
- 部署切换期间保留正在使用的音库；切换验收完成后，旧测试资源不要求为了兼容永久保留。需要回退某次部署时必须有配套的网站和音库，不能只回退目录。已经超过网站容量预算的音库不能靠清空地址回退到同源。
- 仍需要在构建机恢复完整构建输入并生成音库；本轮减少的是网站发布体积，不是开发机缓存，也没有新增个人远程资源库。

实现入口：`src/builtinDistribution.mjs`、`src/builtinFiles.ts`、`tools/sound-distribution.mjs`、`tools/check-static-site.mjs`、`vite.config.ts`、`tools/ai-cli.ts`、`.github/workflows/pages.yml`。

## 分发基础验收（2026-11-07，缩减重复 PCM 前）

- 普通测试 45 个文件、375 项通过；完整音库测试 6 个文件、16 项通过，构建输入校验通过。
- `npm run build` 的同源产物通过检查，约 951.4 MiB；配置独立音库后构建约 35.1 MiB。独立候选含 1,149 个经哈希验证的音频与授权文件，约 916.3 MiB；内置目录和声音内容未改变。
- 两个本地 HTTP 服务分别模拟网站和资源服务，全量远端字节／哈希／CORS 检查通过；资源服务额外 HTTP gzip 压缩也通过。
- 真实浏览器验证普通音效、独立录音、完整钢琴按需加载，以及当前版本保存、离线重开并导出相同 WAV。AI CLI 经网站描述文件找到独立音库，下载钢琴及录音并离线渲染通过；浏览器与 CLI 的钢琴 WAV SHA-256 均为 `aa13e6b71c1294a1d1f8f641b618956fc2764caebaf9da5743ec0459fd8b4763`。
- 本地日志和候选位于工作区 `test-results/distribution/`（Git 忽略），其中 `library/` 是上传候选。验证页及测试工程也是临时产物，不是内置资源。
- 以上是本地双服务和浏览器验证，不代表生产 CDN、TLS、访问地区、费用或主观音色听审已验收。后续已选择 GitHub，并进一步将音库缩至约 696.8 MiB，见 [GitHub 音库 Pages](github-audio-pages.md)；未提交、推送、上传或切换线上。
