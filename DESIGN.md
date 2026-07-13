---
name: 报告观察家
description: 把长报告变成有判断、有出处、有刊物感的社媒内容
colors:
  ink: "#1d211f"
  paper: "#f3f5f3"
  surface: "#ffffff"
  coral: "#e6513b"
  forest: "#23332c"
  line: "#dce1dc"
  cover-lilac: "#d9c8e4"
  cover-aubergine: "#352846"
  cover-paper: "#f1e8d9"
typography:
  display:
    fontFamily: "PingFang SC, Hiragino Sans GB, Avenir Next, sans-serif"
    fontSize: "68px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.055em"
  headline:
    fontFamily: "PingFang SC, Hiragino Sans GB, Avenir Next, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Avenir Next, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.78
  label:
    fontFamily: "Avenir Next, PingFang SC, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "18px"
  lg: "28px"
components:
  button-primary:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "42px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 11px"
    height: "39px"
---

# Design System: 报告观察家

## Overview

**Creative North Star: "编辑部的样刊桌"**

界面服务于高频、连续的内容生产，安静、清楚、可靠；封面则像一份由独立编辑部出版的行业刊物，有明确栅格、强字级和少量印刷细节。产品拒绝“通用 AI 工具视觉”，也拒绝用装饰掩盖信息层级。

物理场景是一位内容编辑在白天的桌面显示器上连续处理多份 PDF：大部分界面保持低刺激，注意力只在上传、下一步、选中状态和异常提示上集中。封面预览是唯一允许更强视觉个性的区域。

**Key Characteristics:**

- 克制的产品壳，鲜明的编辑封面
- 大标题与小标签形成至少 1.25 倍字级反差
- 纸张色、墨色与单一强调色构成主体
- 状态反馈直接，不使用装饰性动效

## Colors

产品层使用纸白、深墨绿与珊瑚红；封面允许雾紫、茄紫和暖纸色构成独立刊物气质。

### Primary

- **编辑珊瑚红**：只用于主操作、当前选择和关键进度。
- **深林墨色**：用于创作台侧栏与高对比文字。

### Secondary

- **雾紫纸张**：封面主色，不进入日常表单界面。
- **茄紫油墨**：雾紫封面的主文字与线条。

### Neutral

- **工作台纸白**：页面和编辑区域背景。
- **冷灰分隔线**：边界、分区与非活跃状态。
- **暖纸色**：封面替代方案和印刷感底色。

**The Ink Economy Rule.** 一个界面只允许一个行动强调色；一个封面只允许一个主墨色和一个小面积辅助色。

## Typography

**Display Font:** PingFang SC / Hiragino Sans GB
**Body Font:** Avenir Next / PingFang SC
**Label/Mono Font:** Avenir Next

**Character:** 中文标题依靠紧凑字距和宽松行距呈现编辑力度，英文只作为署名、栏目或小号索引，不承担装饰任务。

### Hierarchy

- **Display** (600, 68px, 1.05)：上传首页和封面主标题。
- **Headline** (700, 28px, 1.2)：流程页标题。
- **Title** (700, 18–22px, 1.3)：卡片与审核标题。
- **Body** (400, 14px, 1.78)：编辑正文，最大行长 72ch。
- **Label** (700, 11px, 0.08em)：栏目、状态和页码索引。

**The Human Line Break Rule.** 封面标题按语义和视觉宽度换行，禁止机械地每十个字符切一行。

## Elevation

系统以色阶和细边框分层，阴影只用于浮层、封面实体预览和可点击上传区域。普通卡片保持平整，避免堆叠式 SaaS 卡片感。

### Shadow Vocabulary

- **环境浮层** (`0 16px 34px rgba(42,54,47,.15)`): 封面预览和浮层。
- **轻交互** (`0 7px 24px rgba(48,60,53,.08)`): 可选报告图片。

**The Flat-by-Default Rule.** 静止内容默认无阴影；阴影表示可拿起、可选择或暂时浮在工作台上。

## Components

### Buttons

- **Shape:** 轻微圆角（8–9px），不用胶囊按钮作为默认。
- **Primary:** 珊瑚红底、纸白字，高 42px。
- **Hover / Focus:** 只改变明度并显示清晰焦点环，150–220ms ease-out。
- **Secondary:** 纸白背景与 1px 灰线，不使用灰色填充模拟禁用状态以外的层级。

### Chips

- **Style:** 小号栏目标签可使用紧凑矩形或短胶囊；胶囊仅承载来源、页数等元信息。
- **State:** 选中状态同时改变边框、文字与图标，不能只靠颜色。

### Cards / Containers

- **Corner Style:** 工作卡片 12–16px；封面画布本身无圆角。
- **Background:** 纸白或极浅冷灰。
- **Shadow Strategy:** 默认平面，只有可交互媒体获得轻阴影。
- **Border:** 1px 冷灰边框。
- **Internal Padding:** 18–28px，按信息密度变化。

### Inputs / Fields

- **Style:** 纸白背景、1px 冷灰描边、8px 圆角。
- **Focus:** 珊瑚红外环，不能只改变边框色。
- **Error / Disabled:** 文字解释与状态色同时出现。

### Navigation

侧栏使用深林墨色，当前任务用同色系浅层高亮；流程进度使用细线和编号，不增加多余插画。

### Editorial Cover

封面使用 3:4 竖版栅格：顶部栏目与品牌署名、中部主题标签、主标题及其对应英文小标题、底部页数和编辑宣言。主标题使用去除来源后的报告原标题，按语义平衡为不超过两行；英文小标题由同一中文标题翻译，字号清晰并控制在两行左右。小红书发布标题与封面标题是两个独立字段，修改发布标题不能改变封面。允许极轻的纸张颗粒与套印线，禁止渐变、光晕、3D 图标和无意义抽象形状。

## Do's and Don'ts

### Do:

- **Do** 用网格、字级和留白建立封面辨识度。
- **Do** 让主题、标题双语、页数和品牌署名各自占据稳定位置。
- **Do** 保持键盘焦点、对比度和 reduced-motion 支持。
- **Do** 让封面主标题按语义自然换行。

### Don't:

- **Don't** 使用“通用 AI 工具视觉”：渐变光晕、漂浮圆球、玻璃卡片、无意义科技线条。
- **Don't** 使用侧边粗色条、渐变文字或英雄数字 SaaS 模板。
- **Don't** 用大圆角把封面做成 App 卡片；封面是一张刊物，不是组件。
- **Don't** 把“家人们、姐妹们、救命、谁懂啊”写进产品示例或封面。
- **Don't** 使用可替换主题仍成立的万能文案作为视觉占位符。
