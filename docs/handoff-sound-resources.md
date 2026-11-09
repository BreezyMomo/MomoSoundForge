# 声音资源交接

当前架构是“工程框架 + 外部自描述音库”。主工程不包含采样目录、资源清单、映射副本或音频生成物。

后续 AI 整理乐器前必读 [乐器整理规则](instrument-library-rules.md)，当前已发布结果见 [管弦乐器交接](handoff-orchestra-complete.md)。完整乐器组织、对应音源替换、中英文名称和映射验收不再只依赖聊天记录。

## 入口

- 远程协议：`src/remoteLibrary.ts`、`src/remoteSubscriptions.ts`。
- 资源图与完整依赖：`src/resourceGraph.ts`、`src/resourcePackage.ts`。
- 音频缓存与内容 ID：`src/sharedAudio.ts`。
- 资源浏览：`src/SoundLibrary.tsx`。

官方目录和 VCSL 补充目录由部署配置自动订阅。用户下载资源到个人库后，工程和资源包都携带完整依赖，可以断开音库继续编辑、保存和导出。

验证当前版本：

```sh
npm test
npm run build
```

不要恢复旧的本地音库构建流程，不要在主仓库添加采集清单、映射或大型音频。音源更新先在对应资源仓库发布新的固定目录，再更新部署地址。
