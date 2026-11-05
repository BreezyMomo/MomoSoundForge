# 连接与编辑

## 安装和启动

用户从 SoundForge 顶部 AI 工具下载 ZIP，解压后将 `momo-sound-forge` 目录放进其 AI 客户端支持的 Skill 目录，或者使用“选择技能目录并安装”。安装器备份已变更文件。重新加载 Skill 后，准备 Node.js 22+。

从本 Skill 目录运行：

```sh
node scripts/server.mjs --port 8799 --allow-origin http://127.0.0.1:5180
```

`--allow-origin` 必须是用户正在使用的编辑器来源（协议、主机、端口）；可重复指定，不能使用通配符。网页部署在 HTTPS 也可使用本机服务，浏览器可能要求本地网络权限。仅监听 `127.0.0.1`。先 GET `/health` 检查同端口服务；来源需调整时由用户授权的本次服务重启，不能终止不相关进程。在 Windows 后台启动服务用隐藏窗口。

服务启动后让用户点击“连接当前页面”，复制显示的 MCP 配置到支持 Streamable HTTP 的 AI 客户端。配置含本次服务随机令牌，不写进工程、不公开分享。不同客户端的配置格式可能不同，以客户端支持为准，endpoint 和 Authorization 值不变。纯云端执行环境不能直接连接用户电脑的回环地址，使用离线工程交付。

## 一次创作

1. `sound_pages`：确认目标名称与 pageId；多个页面且目标不明确时询问，不选默认第一页。
2. `sound_schema` 与 `sound_catalog`：查询支持的编辑字段和实际声音 ID。默认只查询内置目录；用户要求使用自己的声音时用 personal。目录每页 40 条，通过 nextOffset 继续。
3. `sound_capture`：获取 snapshotId、声音树、乐器区域和视频标记。素材只有元数据，不自动传输 PCM。每页只有一个当前快照，再次捕获使旧 snapshotId 失效。
4. `sound_edit`：传 pageId、snapshotId、operations。默认 edit 保留现有内容；create 清空再创建，只在用户要求新作品时使用。一个批次一个撤销记录；任何操作无效则全批不应用。
5. 修改返回新 capture。用新 snapshotId 调 `sound_render` 获取 WAV 和数值。可给 node `{path:[],id:"..."}` 单独试听；完整作品响应过大时指定 start/end 区间，或者 `sound_export` 下载完整 WAV 和工程。

示例：

```json
{"operations":[
  {"op":"add","layer":{"id":"pickup-tone","name":"拾取亮点","wave":"sine","frequency":880,"endFrequency":1320,"duration":0.3,"gain":0.25}},
  {"op":"project","patch":{"duration":1}}
]}
```

`insert` 使用目录返回的 `soundId`，或者完整 `project`。插入结果是可展开分组；再次 capture 后按实际子节点路径调整，不能猜自动 ID。每个节点有修饰 effects；修改 effects 或 score 是整体替换该字段，应保留未修改项。调整乐器音符时先读取原 score 的 instruments，然后替换 notes。修改分组内容会重新计算分组时长；作品时长需明确设置，超出作品范围的内容不会默认导出。

`sound_history` 按 fresh snapshot 撤销/重做。`sound_save_library` 保存为新的个人库资源，不覆盖同名旧项，先读回结果避免超时重试产生重复。`sound_project` 显式取得带采样的原生工程，可能较大。

客户端断开、超时或取消后不能推断操作失败。先查询连接页、重新捕获，核对内容或个人目录，再决定是否继续。用户编辑后旧 snapshot 写入会被拒绝；渲染同一 snapshot 始终对应同一作品版本。
