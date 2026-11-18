# WebGL1 conformance 持续推进计划

## 目标和起点

在 headless Chrome 中，让原生 WebGL、Refral JS、Refral Rust/Wasm 执行固定的 WebGL 1.0.4 官方清单。目标是两套 Refral 核心分别通过全部 971 个原始文件，维持已有的公共 API、图像差分、实际 Wasm 和部署回归。Chrome 原生结果用于定位差异，行为依据仓库锁定的 [WebGL、IDL、GLES 和 ESSL 规范](../spec-map.md)。[官方清单入口](https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/sdk/tests/webgl-conformance-tests.html)

2026-11-18 的完整结果来自 headless Chrome 158.0.8127.36、macOS arm64，Refral 使用 Apple Metal 3 硬件 adapter。三路都有 971 条结果和用例截图。完整运行使用 88c7fe1，6 张截图在 0f0f3a9 补采，渲染代码与断言计数一致。集成版本为 1bb6537。[截图采集记录](052-conformance-case-screenshots.md)

| 后端 | 通过 | 断言失败 | 未支持 | 超时 | 运行器错误 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chrome 原生 | 968 | 3 | 0 | 0 | 0 |
| Refral JS | 850 | 51 | 39 | 14 | 17 |
| Refral Rust/Wasm | 853 | 48 | 39 | 14 | 17 |

两套核心尚有 121 个不同文件要追踪，其中 118 个两路均未通过，另外 3 个只在 JS 失败。完整原始记录在 `artifacts/conformance/case-screenshots/summary.json`，可按 URL 关联三路断言和图像。`failure-clusters.json` 的标签会重叠，工作量按唯一 URL 和后端计算。完整基线须包含 2,913 条有效记录；缺文件、缺断言、适配器错误和中途退出分别保留。

首批选择器已在 1bb6537 上用 headless Chrome 实跑。三个文件都走到上游完成回调，Chrome 原生通过 246 条断言，JS 通过 106 条、失败 18 条，Rust 通过 124 条。两个名称错误文件还会按 `WEBGL_lose_context` 是否可用执行丢失分支，Chrome 各执行 118 条，当前两套核心各执行 57 条。第一批先修正 JS 的 18 条失败，丢失分支留入生命周期任务。九份逐文件结果及截图在 `artifacts/conformance/campaign/baseline-1bb6537-names/`。

## 已交付的批次

名称校验后首次全量复测使用 035a959，三路各跑完 971 个文件。原生 968、JS 854、Rust 854。JS 新增四个通过，Rust 新增一个，均无退步。两个核心未通过的 117 个 URL 完全相同。三路共 2,913 张有效页面截图，结果在 `artifacts/conformance/campaign/location-names/full`。之后的记录列出各批实际复测的原始文件，全量分母始终为 971。

| 合入 | 行为 | 原始用例与实测 |
| --- | --- | --- |
| [#41](https://github.com/GhostFlying/refral/pull/41) | location 名称验证 | 三个原始文件三路全部通过。JS 的 18 条失败断言归零。 |
| [#42](https://github.com/GhostFlying/refral/pull/42) | 压缩纹理无扩展分支 | 10 个文件全过。Chrome 2,942 条断言，JS、Rust 各 115 条。 |
| [#43](https://github.com/GhostFlying/refral/pull/43) | hint、lineWidth 与状态查询 | hint、gl-line-width、gl-enum-tests 三路通过。gl-get-calls 仍有独立状态缺口。 |
| [#44](https://github.com/GhostFlying/refral/pull/44) | 零尺寸与超限 canvas 的 GPU 配置和恢复 | 两个文件三路各过 40 条，未出现 GPU validation error。 |
| [#45](https://github.com/GhostFlying/refral/pull/45)、[#46](https://github.com/GhostFlying/refral/pull/46) | ANGLE varying 数组与阶段 uniform packing | 三个原始文件三路各过 43、181、5 条。OGLES build 组仍有一条链接失败。 |
| [#47](https://github.com/GhostFlying/refral/pull/47) | 同线程 OffscreenCanvas 上下文和纹理源 | 10 个文件三路各过 9,876 条，实际核心、可选分支及截图见任务 061。 |
| [#48](https://github.com/GhostFlying/refral/pull/48) | 不完整纹理的采样反馈判断 | 原始文件 Chrome 11 条，JS、Rust 各 5 条。差分检查了回退颜色和恢复完整后的错误。 |
| [#49](https://github.com/GhostFlying/refral/pull/49) | 线图元、三角扇与空索引绘制 | 四个原始文件每路 97 条断言均通过；三路 64×64 图像逐通道一致。 |

## 下一批从哪里开始

| 顺序 | 范围与依赖 | 首组选用的原始文件和验收行为 |
| --- | --- | --- |
| 1. 名称校验 | JS 的 `bindAttribLocation`、`getAttribLocation`、`getUniformLocation`。将长度、GLSL 字符集、保留前缀、错误顺序和返回值写入两套核心共用的断言。 | `gl-get-attrib-location-errors.html`、`attrib-location-length-limits.html`、`gl-get-uniform-location-errors.html`。三路分别完成三个文件。补查 256/257 字符、失效 program 和失败调用后的绑定状态。原始 `webgl-specific.html` 中的保留前缀断言可单独核对，整文件另有 lineWidth 依赖。 |
| 2. 核心查询与可选扩展 | 先处理无压缩扩展时的 `COMPRESSED_TEXTURE_FORMATS` 返回类型、`compressedTexImage2D`、`compressedTexSubImage2D` 的参数验证和 GL 错误。再按失败断言拆 `getParameter`、`hint`、`lineWidth` 等状态调用。 | 首查 `compressed-tex-image.html`、`webgl-compressed-texture-pvrtc.html`、`ext-texture-compression-bptc.html`；随后查 `gl-get-calls.html` 和 `hint.html`。分别记录原始脚本走的是未启用、已启用还是未提供扩展的分支，以及断言计数。 |
| 3. 绘制图元和索引 | 在两套核心和共享 host 中补齐线与三角扇，验证 LINE_LOOP 的闭合边、索引偏移、零数量、越界和绘制快照。点绘制另拆任务，覆盖着色器的点尺寸与片元坐标。 | `line-loop-tri-fan.html`、`draw-elements-out-of-bounds.html`、`point-no-attributes.html`、`point-size.html`。再回看被图元缺口提前终止的 blending、uniform 和纹理文件。 |
| 4. 默认绘制缓冲区与 Canvas | 先处理零尺寸、超设备上限的分配、提交和呈现，再处理 `preserveDrawingBuffer`、alpha 合成、Canvas 作为复制源，以及呈现后的清除时机。 | `zero-sized-canvas.html`、`drawingbuffer-test.html`、`buffer-preserve-test.html`、`draw-webgl-to-canvas-test.html`。用同一帧区分立即读回、浏览器合成与跨帧再次使用。 |
| 5. 编译和链接 | 按可复现着色器拆 varying 数组、struct uniform 反射和布局、sampler 数组、packing 上限、跨阶段匹配。一个修复贯穿编译、链接、查询和所需的绘制。 | `shader-varying-packing-restrictions.html`、`shaders-with-uniform-structs.html`、`shader-with-too-many-uniforms.html` 和 OGLES 的 `build_009_to_016.html`。保留 ESSL、诊断、WGSL 和设备错误。依赖编译器的图元或其他用例可以把对应小任务提前。 |
| 6. OffscreenCanvas、Worker 与生命周期 | 先验证同线程中实际核心创建 OffscreenCanvas 上下文，再验证专用 Worker 中的工厂、资源和生命周期，最后处理 transfer、丢失与恢复。与已支持的 OffscreenCanvas 纹理上传分开计数。 | `context-creation.html`、`context-creation-worker.html`、`offscreencanvas-resize.html` 和 `context-lost-restored-worker.html`。重跑带 offscreen 获取上下文诊断的 8 个 `textures/webgl_canvas/` 文件，检查每次实际选用的核心。 |
| 7. 剩余文件逐项清零 | 每次全量后重新枚举所有非通过的 URL，分配给已有任务或创建小任务。涵盖包装对象身份、其余状态、纹理来源、色域、扩展以及新浮现的错误。 | 每个剩余 URL 有所属模块、首条有效诊断、相关规范和下一次验证命令。完成一个分组后重新采样，某个分组的结束不会使余项从分母消失。 |

顺序根据已证实的依赖调整。例如，两个核心在 OffscreenCanvas 模块均为 0/12，Chrome 为 10/12，该模块同时涉及 Worker、恢复和不同的原生结果。先隔离同线程获取上下文的根因，再评估它能解开哪些文件。各波次举例均为验收候选，获得新增通过数以后才更新基线。

## 持续推进与交接

1. 从最新主线和最近的完整汇总开始，按 URL 对齐两套核心与 Chrome。先处理已复现的回归，然后选择能解开其他用例且可独立验收的一项。同类错误先取一个最小原始文件，确认首次偏离发生在 facade、核心、编译器、host 还是测试适配器。给超时和运行器错误保留具体故障与阶段。
2. 为本轮建一个任务，记录归属文件、规范断言、失败指纹、前置依赖和精确的原始文件选择器。用共享测试覆盖两套核心的合法输入、错误返回及错误调用后的状态。原始脚本、断言、超时策略、容差和扩展声明的变动必须单独说明其依据。
3. 在 headless Chrome 中单 worker 依次验证 native、JS、Rust，记录实际核心、可选能力、完成状态和断言数。每批运行受影响的确定性检查和相邻已通过用例。修改 Wasm、编译器或 host 时验证真实构建产物。资源和图像问题保留调用顺序以及三路截图或像素读回。
4. 按现有约定自动提交、推送、开 PR，在当前 head 的 `ci/required` 通过后 rebase 合入，验证主线。GPU、完整 CTS 和性能保留本地或 optional/daily 入口。每个合并任务记录所用提交、匹配的原始文件、三路前后结果、新回归、下一项以及证据目录。下一轮以该记录恢复。
5. 每完成一个能力组、修改共享 runner，或局部修复可能改变大量文件的执行路径时，在新证据目录跑完整 971 × 3。闭环前以最终提交再做完整运行及相关部署回归。报告刷新 MDN 逐项能力、三路结果和每个文件的对照图。分别列出新通过、退步、提前退出和虽通过但因可选能力执行了不同分支的文件。

第一批可用以下命令复现。在仓库已安装锁定依赖、CTS 和两个 Wasm 产物的环境中运行。三个后端分开启动，退出异常时仍可检查各自的原始 checkpoint。每个新代码版本使用自己的目录；同一版本和配置的断点恢复沿用该次目录。

```sh
export REFRAL_HEADLESS=1
scope='^conformance/(attribs/gl-get-attrib-location-errors|glsl/misc/attrib-location-length-limits|uniforms/gl-get-uniform-location-errors)\.html$'
out="artifacts/conformance/campaign/$(git rev-parse --short HEAD)-names"
for backend in native js rust; do
  pnpm conformance:run --backend "$backend" --include "$scope" --screenshots --timeout-ms 5000 --output "$out"
done
```

完整运行用独立目录，省略 `--include`，其余采集参数与可比较基线一致。完成三路后执行 `pnpm conformance:report --input "$out"`，检查 inventory、complete、inputIssues、逐文件实际核心和原始计数。仅针对子集运行时使用各后端的 `results.json` 验收本批。

## 什么时候收口或停下来

- **完成。** 两套核心在同一最终构建各通过 971/971，原始脚本按其适用能力执行并完成，来源可核查，已有工程回归通过。单列 Chrome 自身失败、上游按能力条件跳过的分支，以及 Chrome 提供而 Refral 尚未提供的可选能力。如需宣称与 Chrome 的某项扩展能力一致，要在实际启用该扩展后验证相同分支。
- **存在硬阻塞。** 同一用例能稳定复现，规范、原始断言和最小复现已核对，已尝试可行的项目内实现或修复，剩余前提是明确的外部变更或不可用能力。记录影响文件、尝试、替代方案的限制、上游进度和恢复条件。保留原始失败。其他可独立推进的任务继续，所有剩余工作都依赖该阻塞时交回。
- **需要用户决定。** 当仅存可行方案会改变已约定的公共 API、增加新的强制运行期依赖、要求页面启用跨源隔离，或需要接受规范偏差时，给出受影响文件、两个可选路径、实测取舍与推荐项，暂停依赖这项选择的工作。日常实现、可逆实验、Wasm 重建、普通 PR 拆分与合入由 agent 推进。
- **原生也失败。** 本基线有 `shader-with-double-underscore.html`、`offscreencanvas/methods.html`、`offscreencanvas/methods-worker.html`。逐条比较具体断言和完成路径。当前后两项在 Refral 提前结束，仍需实现。能遵循规范并通过原始断言时照常修复；若证据指向上游断言冲突或平台缺陷，记入阻塞或提交用户裁决，统计仍显示实际通过数。

本计划维护范围是本文件和路线图入口。各实现任务拥有自己的代码、验证和结果记录。计划检查使用 `pnpm ci:check`，首批选择器应在每个后端恰好选中上述三个 URL。
