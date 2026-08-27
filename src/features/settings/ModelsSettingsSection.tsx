/**
 * @file 设置 · 模型供应商与模型列表
 * @author Charlie
 * @description 管理 AI Provider（Base URL / API 格式 / Key）与下属模型。
 * Base URL 按所选协议原样使用，不做供应商特例改写。
 */

import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingField } from "@/features/settings/SettingField";
import {
  formatTokenCount,
  parseContextWindow,
} from "@/lib/agent/contextBudget";
import {
  createAiModel,
  createAiProvider,
  deleteAiModel,
  deleteAiProvider,
  listAiModels,
  listAiProviders,
  updateAiModel,
  updateAiProvider,
  type AiApiFormat,
  type AiModelRow,
  type AiProviderRow,
} from "@/lib/db";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function formatContextBadge(tag: string) {
  if (!tag) return "—";
  return formatTokenCount(parseContextWindow(tag));
}

type ModelDraft = {
  modelId: string;
  contextWindow: string;
  maxOutput: string;
  showAdvanced: boolean;
};

const EMPTY_MODEL_DRAFT: ModelDraft = {
  modelId: "",
  contextWindow: "128000",
  maxOutput: "8192",
  showAdvanced: false,
};

/** 模型设置：供应商 Tab + 表单 + 模型列表 */
export function ModelsSettingsSection() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<AiProviderRow[]>([]);
  const [models, setModels] = useState<AiModelRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [format, setFormat] = useState<AiApiFormat>("openai");
  const [apiKey, setApiKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingModel, setEditingModel] = useState<AiModelRow | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelDraft>(EMPTY_MODEL_DRAFT);
  const [addingModelOpen, setAddingModelOpen] = useState(false);

  const reload = useCallback(async () => {
    const [p, m] = await Promise.all([listAiProviders(), listAiModels()]);
    setProviders(p);
    setModels(m);
    if (selected == null && p[0]) {
      setSelected(p[0].id);
      setName(p[0].name);
      setBaseUrl(p[0].base_url);
      setFormat(p[0].api_format);
    }
  }, [selected]);

  useEffect(() => {
    void reload().catch(console.error);
  }, [reload]);

  const cur = providers.find((p) => p.id === selected) ?? null;
  const showForm = adding || cur != null || providers.length === 0;

  const fillFrom = (p: AiProviderRow) => {
    setSelected(p.id);
    setName(p.name);
    setBaseUrl(p.base_url);
    setFormat(p.api_format);
    setApiKey("");
    setAdding(false);
  };

  const startAdd = () => {
    setAdding(true);
    setSelected(null);
    setName("");
    setBaseUrl("");
    setFormat("openai");
    setApiKey("");
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("settings.models")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("settings.modelsHint")}
        </p>
      </div>

      {providers.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => fillFrom(p)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                selected === p.id && !adding
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border hover:bg-muted"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${p.enabled ? "bg-emerald-500" : "bg-muted-foreground"}`}
              />
              {p.name}
            </button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            onClick={startAdd}
          >
            <Plus size={12} className="mr-1" />
            {t("settings.addProvider")}
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" onClick={startAdd}>
          <Plus size={12} className="mr-1" />
          {t("settings.addProvider")}
        </Button>
      )}

      {showForm ? (
        <div className="space-y-1 rounded-md border border-border p-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {adding || !cur
              ? t("settings.addProvider")
              : t("settings.editProvider")}
          </div>
          <SettingField label={t("settings.providerName")}>
            <Input
              value={name}
              placeholder={t("settings.providerName")}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </SettingField>
          <SettingField label="Base URL" hint={t("settings.baseUrlHint")}>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.currentTarget.value)}
              placeholder={
                format === "anthropic"
                  ? "https://api.anthropic.com"
                  : "https://api.openai.com"
              }
            />
          </SettingField>
          <SettingField
            label={t("settings.apiFormat")}
            hint={t("settings.apiFormatHint")}
          >
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as AiApiFormat)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">
                  {t("settings.apiFormatOpenai")}
                </SelectItem>
                <SelectItem value="anthropic">
                  {t("settings.apiFormatAnthropic")}
                </SelectItem>
                <SelectItem value="responses">
                  {t("settings.apiFormatResponses")}
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingField>
          <SettingField label="API Key" hint={t("settings.apiKeyHint")}>
            <Input
              type="password"
              value={apiKey}
              placeholder={cur && !adding ? "••••••••" : ""}
              onChange={(e) => setApiKey(e.currentTarget.value)}
            />
          </SettingField>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                if (!name.trim() || !baseUrl.trim()) {
                  toast.error(t("settings.providerRequired"));
                  return;
                }
                if (adding || !cur) {
                  const enc = apiKey.trim()
                    ? await api.encryptSecret(apiKey.trim())
                    : "";
                  const id = await createAiProvider({
                    name: name.trim(),
                    base_url: baseUrl.trim(),
                    api_format: format,
                    api_key_enc: enc,
                  });
                  setSelected(id);
                  setAdding(false);
                  setApiKey("");
                  await reload();
                  toast.success(t("settings.providerAdded"));
                } else {
                  const patch: {
                    name: string;
                    base_url: string;
                    api_format: AiApiFormat;
                    api_key_enc?: string;
                  } = {
                    name: name.trim(),
                    base_url: baseUrl.trim(),
                    api_format: format,
                  };
                  if (apiKey.trim()) {
                    patch.api_key_enc = await api.encryptSecret(apiKey.trim());
                  }
                  await updateAiProvider(cur.id, patch);
                  setApiKey("");
                  await reload();
                  toast.success(t("settings.saved"));
                }
              }}
            >
              {t("settings.saveProvider")}
            </Button>
            {cur && !adding ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={async () => {
                  await deleteAiProvider(cur.id);
                  setSelected(null);
                  setAdding(false);
                  await reload();
                }}
              >
                <Trash2 size={12} className="mr-1" />
                {t("settings.deleteProvider")}
              </Button>
            ) : null}
          </div>

          {cur && !adding ? (
            <div className="space-y-2 border-t border-border pt-3">
              <div className="text-xs font-medium">
                {t("settings.modelList")}
              </div>
              <ul className="space-y-1">
                {models
                  .filter((m) => m.provider_id === cur.id)
                  .map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {m.label || m.model_id}
                          <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                            {formatContextBadge(m.context_tag)}
                          </span>
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {m.model_id}
                          {(m.max_output_tokens ?? 0) > 0
                            ? ` · max out ${formatTokenCount(m.max_output_tokens)}`
                            : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          title={t("settings.editModel")}
                          onClick={() => {
                            setEditingModel(m);
                            setModelDraft({
                              modelId: m.model_id,
                              contextWindow: String(
                                parseContextWindow(m.context_tag || "128k"),
                              ),
                              maxOutput: String(m.max_output_tokens || 8192),
                              showAdvanced: false,
                            });
                          }}
                        >
                          <Pencil size={12} />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          onClick={async () => {
                            await deleteAiModel(m.id);
                            await reload();
                          }}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </li>
                  ))}
              </ul>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setAddingModelOpen(true);
                  setModelDraft({ ...EMPTY_MODEL_DRAFT });
                }}
              >
                <Plus size={12} className="mr-1" />
                {t("settings.addModel")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ModelConfigDialog
        open={editingModel != null || addingModelOpen}
        title={
          editingModel
            ? t("settings.editModelTitle")
            : t("settings.addModelTitle")
        }
        draft={modelDraft}
        onDraftChange={setModelDraft}
        onClose={() => {
          setEditingModel(null);
          setAddingModelOpen(false);
        }}
        onSave={async () => {
          const mid = modelDraft.modelId.trim();
          if (!mid) {
            toast.error(t("settings.modelIdRequired"));
            return;
          }
          const ctx = modelDraft.contextWindow.trim() || "128000";
          const maxOut = Number(modelDraft.maxOutput) || 0;
          if (editingModel) {
            await updateAiModel(editingModel.id, {
              model_id: mid,
              label: mid,
              context_tag: ctx,
              max_output_tokens: maxOut,
            });
            toast.success(t("settings.saved"));
          } else if (cur) {
            await createAiModel({
              provider_id: cur.id,
              model_id: mid,
              context_tag: ctx,
              max_output_tokens: maxOut,
            });
            toast.success(t("settings.modelAdded"));
          }
          setEditingModel(null);
          setAddingModelOpen(false);
          await reload();
        }}
      />
    </section>
  );
}

/** 新建 / 编辑模型弹窗 */
function ModelConfigDialog({
  open,
  title,
  draft,
  onDraftChange,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  draft: ModelDraft;
  onDraftChange: (d: ModelDraft) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {t("settings.modelId")}
            </label>
            <Input
              value={draft.modelId}
              placeholder="gpt-4.1"
              onChange={(e) =>
                onDraftChange({ ...draft, modelId: e.currentTarget.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {t("settings.contextWindow")}
            </label>
            <Input
              value={draft.contextWindow}
              placeholder="128000"
              onChange={(e) =>
                onDraftChange({
                  ...draft,
                  contextWindow: e.currentTarget.value,
                })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              {t("settings.contextWindowHint")}
            </p>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-1 text-left text-sm font-medium"
            onClick={() =>
              onDraftChange({
                ...draft,
                showAdvanced: !draft.showAdvanced,
              })
            }
          >
            <ChevronDown
              size={14}
              className={cn(
                "transition-transform",
                draft.showAdvanced ? "rotate-0" : "-rotate-90",
              )}
            />
            {t("settings.advanced")}
          </button>
          {draft.showAdvanced ? (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <label className="text-sm font-medium">
                {t("settings.maxOutputTokens")}
              </label>
              <Input
                value={draft.maxOutput}
                placeholder="8192"
                onChange={(e) =>
                  onDraftChange({
                    ...draft,
                    maxOutput: e.currentTarget.value,
                  })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                {t("settings.maxOutputTokensHint")}
              </p>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("dialog.cancel")}
          </Button>
          <Button type="button" onClick={() => void onSave()}>
            {t("settings.saveProvider")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
