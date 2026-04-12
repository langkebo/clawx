import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveUserPath } from "../../utils.js";
import { normalizeWorkspaceDir } from "../workspace-dir.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const ImageGenerateSchema = Type.Object({
  prompt: Type.String({ description: "Text description of the image to generate" }),
  model: Type.Optional(Type.String({ description: "Model to use (e.g. openai/dall-e-3, stability/stable-diffusion-xl)" })),
  size: Type.Optional(Type.String({ description: "Image size (e.g. 1024x1024, 512x512). Default depends on model." })),
  quality: Type.Optional(Type.String({ description: "Quality level (e.g. standard, hd for DALL-E)" })),
  style: Type.Optional(Type.String({ description: "Style (e.g. vivid, natural for DALL-E)" })),
  n: Type.Optional(Type.Number({ description: "Number of images to generate (default: 1)" })),
  outputDir: Type.Optional(Type.String({ description: "Directory to save generated images (default: workspace)" })),
});

type ImageGenerateResult = {
  generated: boolean;
  prompt: string;
  model: string;
  paths: string[];
  error?: string;
};

async function generateWithOpenAI(params: {
  prompt: string;
  apiKey: string;
  model: string;
  size?: string | undefined;
  quality?: string | undefined;
  style?: string | undefined;
  n?: number;
  outputDir: string;
}): Promise<ImageGenerateResult> {
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const size = params.size || "1024x1024";
  const n = params.n || 1;

  const body: Record<string, unknown> = {
    model: params.model.replace("openai/", ""),
    prompt: params.prompt,
    size,
    n,
  };
  if (params.quality) body.quality = params.quality;
  if (params.style) body.style = params.style;

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
  const paths: string[] = [];

  for (let i = 0; i < (data.data?.length ?? 0); i++) {
    const item = data.data![i];
    const filename = `generated_${Date.now()}_${i}.png`;
    const filePath = path.join(params.outputDir, filename);

    if (item.b64_json) {
      await fs.writeFile(filePath, Buffer.from(item.b64_json, "base64"));
      paths.push(filePath);
    } else if (item.url) {
      const imgResponse = await fetch(item.url);
      if (imgResponse.ok) {
        const buffer = Buffer.from(await imgResponse.arrayBuffer());
        await fs.writeFile(filePath, buffer);
        paths.push(filePath);
      }
    }
  }

  return {
    generated: true,
    prompt: params.prompt,
    model: params.model,
    paths,
  };
}

export function createImageGenerateTool(options?: {
  config?: OpenClawConfig;
  workspaceDir?: string;
  sandboxed?: boolean;
}): AnyAgentTool {
  return {
    label: "Image Generate",
    name: "image_generate",
    description:
      "Generate images from text descriptions using AI models (DALL-E, Stability AI, etc.). Supports various sizes, qualities, and styles.",
    parameters: ImageGenerateSchema,
    execute: async (_toolCallId, params) => {
      const prompt = readStringParam(params, "prompt", { required: true });
      const model = readStringParam(params, "model") ?? "openai/dall-e-3";
      const size = readStringParam(params, "size");
      const quality = readStringParam(params, "quality");
      const style = readStringParam(params, "style");
      const n = (params.n as number) || 1;
      const outputDir = readStringParam(params, "outputDir")
        ? resolveUserPath(readStringParam(params, "outputDir")!)
        : normalizeWorkspaceDir(options?.workspaceDir) ?? process.cwd();

      try {
        await fs.mkdir(outputDir, { recursive: true });

        const provider = model.split("/")[0]?.toLowerCase() ?? "";

        if (provider === "openai" || provider === "dall-e") {
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            return jsonResult({
              generated: false,
              error: "OPENAI_API_KEY not set. Set it to use DALL-E image generation.",
            });
          }
          const result = await generateWithOpenAI({
            prompt,
            apiKey,
            model,
            size,
            quality,
            style,
            n,
            outputDir,
          });
          return jsonResult(result);
        }

        return jsonResult({
          generated: false,
          error: `Unsupported image generation provider: '${provider}'. Supported: openai/dall-e-3, openai/dall-e-2.`,
        });
      } catch (err) {
        return jsonResult({
          generated: false,
          prompt,
          model,
          paths: [],
          error: `Image generation failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  };
}
