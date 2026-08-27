/**
 * @file LLM 供应商解析
 * @author Charlie
 */

import {
  decodeModelRef,
  listAiModels,
  listAiProviders,
} from "@/lib/db";

export async function resolveProvider(modelRef: string | null | undefined) {
  const providers = await listAiProviders();
  const models = await listAiModels();
  const decoded = decodeModelRef(modelRef);
  let provider = providers.find(
    (p) => p.enabled && p.id === decoded?.providerId,
  );
  let modelId = decoded?.modelId;
  if (!provider) provider = providers.find((p) => p.enabled);
  if (!provider) throw new Error("未配置 AI 供应商，请在设置中添加");
  if (!modelId) {
    const m = models.find((x) => x.provider_id === provider!.id && x.enabled);
    modelId = m?.model_id;
  }
  if (!modelId) throw new Error("未配置模型");
  let apiKey = "";
  if (provider.api_key_enc) {
    try {
      const { api } = await import("@/lib/tauri");
      apiKey = await api.decryptSecret(provider.api_key_enc);
    } catch {
      apiKey = provider.api_key_enc;
    }
  }
  const modelRow = models.find(
    (x) => x.provider_id === provider.id && x.model_id === modelId,
  );
  const maxTokens =
    modelRow?.max_output_tokens && modelRow.max_output_tokens > 0
      ? modelRow.max_output_tokens
      : undefined;
  const contextTag = modelRow?.context_tag ?? "128k";
  return { provider, modelId, apiKey, maxTokens, contextTag };
}

export type ProviderBundle = Awaited<ReturnType<typeof resolveProvider>>;
