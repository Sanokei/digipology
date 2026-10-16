export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  tools: ModelTool[];
  tool_choice: { type: "function"; function: { name: string } };
  max_tokens?: number;
  temperature?: number;
  /**
   * Provider-neutral extra fields merged into the top-level JSON request body
   * by the transport; the transport itself stays provider-agnostic.
   */
  extraBody?: Record<string, unknown>;
}

export const STR = (description: string) => ({ type: "string", description }) as const;
export const NUM = (description: string) => ({ type: "number", description }) as const;
export const BOOL = (description: string) => ({ type: "boolean", description }) as const;

export interface BuildRequestOptions {
  model: string;
  messages: ModelMessage[];
  tool: {
    name: string;
    description: string;
    properties: Record<string, unknown>;
    required: string[];
  };
  maxTokens?: number;
  temperature?: number;
  extraBody?: Record<string, unknown>;
}

/** Builds one strict object-valued function tool and pins the model to it. */
export function buildRequest(options: BuildRequestOptions): ModelRequest {
  const request: ModelRequest = {
    model: options.model,
    messages: [...options.messages],
    tools: [
      {
        type: "function",
        function: {
          name: options.tool.name,
          description: options.tool.description,
          parameters: {
            type: "object",
            properties: { ...options.tool.properties },
            required: [...options.tool.required],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: options.tool.name } },
  };
  if (options.maxTokens !== undefined) request.max_tokens = options.maxTokens;
  if (options.temperature !== undefined) request.temperature = options.temperature;
  if (options.extraBody !== undefined) request.extraBody = options.extraBody;
  return request;
}
