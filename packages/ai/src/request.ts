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
  /**
   * Optional forced function tools. Omit entirely on backends where tool
   * calling is unsupported (e.g. llama-server + Qwen3-0.6B never emits
   * tool_calls) and rely on the raw-JSON extraction ladder instead: sending
   * tools then only wastes prompt tokens.
   */
  tools?: ModelTool[];
  tool_choice?: { type: "function"; function: { name: string } };
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
  /**
   * Optional strict object-valued function tool. When omitted the request
   * carries no tools/tool_choice and the model is expected to emit the
   * payload as raw JSON in its message content.
   */
  tool?: {
    name: string;
    description: string;
    properties: Record<string, unknown>;
    required: string[];
  };
  maxTokens?: number;
  temperature?: number;
  extraBody?: Record<string, unknown>;
}

/**
 * Builds a chat-completion request. When `tool` is provided the model is
 * pinned to one strict object-valued function tool; when omitted the request
 * goes tool-free for the raw-JSON path.
 */
export function buildRequest(options: BuildRequestOptions): ModelRequest {
  const request: ModelRequest = {
    model: options.model,
    messages: [...options.messages],
  };
  if (options.tool !== undefined) {
    request.tools = [
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
    ];
    request.tool_choice = {
      type: "function",
      function: { name: options.tool.name },
    };
  }
  if (options.maxTokens !== undefined) request.max_tokens = options.maxTokens;
  if (options.temperature !== undefined) request.temperature = options.temperature;
  if (options.extraBody !== undefined) request.extraBody = options.extraBody;
  return request;
}
