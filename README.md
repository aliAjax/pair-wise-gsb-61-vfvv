# 汽车型式认证证据包审阅与补件平台

用于按车型、配置、法规项目和维护版本组织测试报告、部件清单、软件版本及豁免材料的本地认证工作台。

## 技术栈

- Nuxt 3 + TypeScript
- Nuxt UI
- Pinia
- Nuxt Router
- ofetch
- TanStack Query for Vue

## 主要工作区

- `/`：认证项目列表、关键词/状态/机构/风险筛选和项目统计
- `/projects/new`：建立车型、配置、维护版本和软件版本基线
- `/projects/[id]`：证据审阅、法规覆盖、状态流转、版本差异、批量补件和审计
- `/regulations`：按法规分类查看项目证据覆盖
- `/supplements`：跨项目批量补件
- `/reminders`：证书和证据到期提醒
- `/audit`：跨项目审批时间线与提交包导出

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:18461`。

## 构建与检查

```bash
npm run typecheck
npm run build
```

项目没有后端服务，使用结构化模拟数据，并通过 Pinia 和浏览器 `localStorage` 持久化车型项目、证据状态、版本和审计记录。ofetch 由本地模拟 fetch 适配器承载，TanStack Query 负责项目索引查询和筛选缓存。

## 补件提交凭据（并发控制）

两名同事可能在不同标签页同时对同一证据包补件，因此每次补件都是一张**可续办的提交凭据（SupplementToken）**，持久化在 `vehicle-type-approval-supplement-tokens-v1`：

- **记住基线与清单**：凭据创建时固化维护版本、软件版本和证据清单快照；勾选的证据与补件说明去抖自动保存。
- **基线失效**：任一标签页修改维护/软件版本后，未完成的凭据立即停在「待核对」（`stale`），已选证据和说明不丢失；核对清单变化后一键按新基线续办，续办凭据会记录上一张完整凭据。
- **失败恢复**：提交失败（可用面板上的「模拟本次提交失败」开关演练）时证据不推进，凭据留在 `failed`，直接用同一凭据重试，从最后一个完整凭据接着处理。
- **幂等提交**：凭据即幂等键，重复提交同一凭据只回放首次结果，不会再次推进证据；他人刚接受（`accepted`）或已被其他凭据提交的证据自动跳过且不被覆盖。
- **认定口径**：法规覆盖（`/regulations`、项目详情法规页）只统计审阅人直接接受、或挂在「已完成」凭据下的证据；审计导出（`/audit`）只导出这些证据，以及由已完成凭据产生的补件审计记录，并附完整凭据清单。批准流转会阻断缺少有效已完成凭据的已提交证据。

核心逻辑位于 `services/supplement-ledger.ts`（账本/原子提交）、`composables/useSupplementCredential.ts`（面板状态机）与 `components/SupplementPanel.vue`（补件界面）。

