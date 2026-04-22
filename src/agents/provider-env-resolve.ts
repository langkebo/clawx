const PROVIDER_ENV_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  dashscope: "DASHSCOPE_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  ark: "ARK_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  qwen: "QWEN_API_KEY",
  minimax: "MINIMAX_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  kimi: "KIMI_API_KEY",
  yi: "YI_API_KEY",
  baichuan: "BAICHUAN_API_KEY",
};

export { PROVIDER_ENV_MAP };

export function looksLikeEnvVarName(value: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(value);
}

export function resolveApiKeyFromEnv(hint?: string, providerName?: string): string {
  if (hint && looksLikeEnvVarName(hint)) {
    const val = process.env[hint]?.trim();
    if (val && !looksLikeEnvVarName(val)) {
      return val;
    }
  }
  if (providerName) {
    const envVar = PROVIDER_ENV_MAP[providerName.toLowerCase()];
    if (envVar) {
      const val = process.env[envVar]?.trim();
      if (val && !looksLikeEnvVarName(val)) {
        return val;
      }
    }
  }
  if (!providerName) {
    for (const envVar of Object.values(PROVIDER_ENV_MAP)) {
      const val = process.env[envVar]?.trim();
      if (val && !looksLikeEnvVarName(val)) {
        return val;
      }
    }
  }
  return "";
}
