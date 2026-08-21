import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, Plus, Sparkles } from "lucide-react";

export function AiChatPanel() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);

  return (
    <div className="panel">
      <div className="panel-header">
        <Sparkles size={14} className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t("terminal.aiTitle")}
        </span>
      </div>
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
