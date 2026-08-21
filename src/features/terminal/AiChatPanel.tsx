/**
 * @file AI 对话面板（占位）
 * @author Charlie
 * @description 终端右侧「AI」标签的聊天 UI 占位实现。
 * 消息仅保存在本地 state，发送后会插入固定的未接后端提示。
 * 当前未对接任何 AI / LLM 服务，后续可在此接入真实对话 API。
 * 注意：本组件为占位/未接后端，勿当作生产能力使用。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, Plus, Sparkles } from "lucide-react";

/**
 * AI 聊天面板：本地假对话，占位/未接后端。
 * 用户发送后会追加一条助手回复，内容为「AI backend is not connected yet.」。
 */
export function AiChatPanel() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);

  return (
    <div className="panel">
      {/* —— 标题栏 —— */}
      <div className="panel-header">
        <Sparkles size={14} className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t("terminal.aiTitle")}
        </span>
      </div>

      {/* —— 消息列表（空态为占位文案） —— */}
      <div className="panel-body space-y-2 p-3">
        {messages.length === 0 && (
          <div className="text-xs muted">{t("placeholder")}</div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`chat-bubble ${
              m.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"
            }`}
          >
            {m.content}
          </div>
        ))}
      </div>

      {/* —— 输入区：仅本地追加消息，未调用后端 —— */}
      <div className="panel-footer">
        <div className="composer">
          <button className="icon-btn icon-btn-sm">
            <Plus size={14} />
          </button>
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("terminal.aiPlaceholder")}
            className="composer-input"
          />
          <button
            className="icon-btn icon-btn-sm icon-btn-primary"
            onClick={() => {
              if (!text.trim()) return;
              setMessages((m) => [
                ...m,
                { role: "user", content: text.trim() },
                {
                  role: "assistant",
                  // 占位/未接后端：固定英文提示，非真实 AI 回复
                  content: "AI backend is not connected yet.",
                },
              ]);
              setText("");
            }}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
