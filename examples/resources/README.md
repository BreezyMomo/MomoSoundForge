# 可导入的声音资源示例

- `fm-bell.sfsynth`：带“Brightness”参数的调频铃声生成器，保存生成表达式而非音频。
- `fm-bell-keys.sfinstrument`：将该合成器绑定至 C2–C7 的乐器定义，不含旋律。

在 **声音资源库 → 管理资源 → 导入资源文件…** 中选择文件，试听后保存到自己的本地库。合成器点“用它创作”；乐器点“使用乐器写音符”，然后添加音符。

The files contain a parameterized FM bell synthesizer and an instrument mapping it to C2–C7, without a melody. Import from **Sound resources → Manage resources → Import resource file…**, preview, then save to a local library. Add notes after inserting the instrument. Both definitions carry the generating algorithm and require no external recordings.

生成逻辑为本项目示例代码；尚未完成主观音质评审。/ These example algorithms have not undergone a subjective sound-quality review.
