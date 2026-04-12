import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { extractFileContentFromSource } from "../../media/input-files.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const PdfToolSchema = Type.Object({
  action: Type.Union([Type.Literal("extract")], {
    description: "Action to perform. Currently only 'extract' is supported.",
  }),
  path: Type.Optional(
    Type.String({ description: "Local file path to the PDF (relative to workspace)" }),
  ),
  url: Type.Optional(Type.String({ description: "URL to fetch the PDF from" })),
  pages: Type.Optional(
    Type.Number({ description: "Max pages to extract (default: 20)" }),
  ),
  includeImages: Type.Optional(
    Type.Boolean({ description: "Whether to include extracted images (default: false)" }),
  ),
});

export function createPdfTool(options?: {
  workspaceDir?: string;
  sandboxed?: boolean;
}): AnyAgentTool {
  return {
    label: "PDF",
    name: "pdf",
    description:
      "Extract text and optionally images from a PDF file. Provide either a local file path or a URL.",
    parameters: PdfToolSchema,
    execute: async (_toolCallId, params) => {
      const action = readStringParam(params, "action");
      const filePath = readStringParam(params, "path");
      const url = readStringParam(params, "url");
      const maxPages = readNumberParam(params, "pages") ?? 20;
      const includeImages = params.includeImages === true;

      if (action !== "extract") {
        return jsonResult({ error: `Unknown action: ${action}. Use 'extract'.` });
      }

      if (!filePath && !url) {
        return jsonResult({ error: "Provide either 'path' or 'url' for the PDF source." });
      }

      try {
        if (filePath) {
          const resolvedPath = path.resolve(options?.workspaceDir ?? process.cwd(), filePath);
          const buffer = await fs.readFile(resolvedPath);
          const result = await extractFileContentFromSource({
            source: {
              type: "base64",
              data: buffer.toString("base64"),
              mediaType: "application/pdf",
              filename: path.basename(resolvedPath),
            },
            limits: {
              allowUrl: false,
              allowedMimes: new Set(["application/pdf"]),
              maxBytes: 20 * 1024 * 1024,
              maxChars: 500_000,
              maxRedirects: 3,
              timeoutMs: 30_000,
              pdf: {
                maxPages,
                maxPixels: 8_000_000,
                minTextChars: 50,
              },
            },
          });

          return jsonResult({
            action: "extract",
            filename: result.filename,
            text: result.text ?? "",
            imageCount: includeImages ? (result.images?.length ?? 0) : undefined,
            pages: maxPages,
            source: filePath,
          });
        }

        if (url) {
          const result = await extractFileContentFromSource({
            source: {
              type: "url",
              url,
              mediaType: "application/pdf",
            },
            limits: {
              allowUrl: true,
              allowedMimes: new Set(["application/pdf"]),
              maxBytes: 20 * 1024 * 1024,
              maxChars: 500_000,
              maxRedirects: 3,
              timeoutMs: 30_000,
              pdf: {
                maxPages,
                maxPixels: 8_000_000,
                minTextChars: 50,
              },
            },
          });

          return jsonResult({
            action: "extract",
            filename: result.filename,
            text: result.text ?? "",
            imageCount: includeImages ? (result.images?.length ?? 0) : undefined,
            pages: maxPages,
            source: url,
          });
        }

        return jsonResult({ error: "No valid source provided." });
      } catch (err) {
        return jsonResult({
          error: `PDF extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  };
}
