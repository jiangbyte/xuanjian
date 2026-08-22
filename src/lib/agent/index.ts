/**
 * @file 本地 Agent 模块入口说明（目录索引）
 * @author Charlie
 *
 * 布局：
 * - runtime.ts      入口：本地 / 远程运行时分发
 * - react.ts        Orchestrator + SubAgent ReAct 循环
 * - subagents.ts    SubAgent 角色与工具白名单
 * - tools.ts        本地工具定义与执行
 * - llm.ts          聊天请求与回复归一化
 * - types.ts        事件 / 输入类型
 * - contextBudget.ts 上下文估算与思考模式持久化
 * - remoteClient.ts 远程 Agent HTTP/SSE
 * - mcpBuiltin.ts   内置 MCP 元数据
 * - ansi.ts         终端 ANSI 清洗
 */
export {};
