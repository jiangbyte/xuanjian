/**
 * @file AI 对话面板（占位）
 * @author Charlie
 * @description 终端右侧「AI」标签的聊天 UI 占位实现。
 * 消息仅保存在本地 state，发送后会插入固定的未接后端提示。
 * 当前未对接任何 AI / LLM 服务，后续可在此接入真实对话 API。
 * 注意：本组件为占位/未接后端，勿当作生产能力使用。
 */

import { Plus, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* —— 标题栏 —— */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles size={14} className="text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t("terminal.aiTitle")}
        </span>
      </div>

      {/* —— 消息列表（空态为占位文案） —— */}
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("placeholder")}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "rounded-md px-2 py-1.5 text-xs",
              m.role === "user"
                ? "bg-accent text-accent-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {m.content}
          </div>
        ))}
      </div>

      {/* —— 输入区：仅本地追加消息，未调用后端 —— */}
      <div className="border-t border-border p-3">
        <div className="rounded-md border border-border bg-background p-2">
          <div className="flex items-end gap-2">
            <Button type="button" size="icon-sm" variant="ghost">
              <Plus size={14} />
            </Button>
            <Textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("terminal.aiPlaceholder")}
              className="min-h-0 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <Button
              type="button"
              size="icon-sm"
              onClick={() => {
                if (!text.trim()) return;
                setMessages((m) => [
                  ...m,
                  { role: "user", content: text.trim() },
                  {
                    role: "assistant",
                    content: "AI backend is not connected yet.",
                  },
                ]);
                setText("");
              }}
            >
              <Send size={12} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
