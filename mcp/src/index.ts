// @checkbox-site/mcp — the Checkbox MCP server (tools, resources, prompts) shared by the remote endpoint
// (https://app.checkbox.site/mcp, apps/api/src/mcp) and the local stdio binary (dist/bin.js).
export {
  API_VERSION,
  CheckboxApiError,
  DEFAULT_API_BASE,
  createHttpApi,
  fromSdkClient,
  interpretResponse,
  withQuery,
  type ApiRequestOptions,
  type CheckboxApi,
  type HttpMethod,
  type NextAction,
} from './api.ts';
export { OPERATION_TOOLS, describeNextAction, renderError, renderOutput, type ToolOutput } from './format.ts';
export { NO_KEY, keyAllows, keyContextFromPrefix, type KeyContext, type KeyRole, type ToolScope } from './permissions.ts';
export { CATALOG_URI, QUICKSTART_URI, makeMyCheckoutCompliantPrompt, quickstartMarkdown, renderCatalog, type CoverageDoc } from './resources.ts';
export { DEFAULT_MCP_URL, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION, createCheckboxMcpServer, type CheckboxMcp, type CheckboxMcpOptions } from './server.ts';
export { TOOLS, TOOL_OPERATIONS, ToolError, toolVisible, type IssuedKeys, type ToolContext, type ToolDef } from './tools.ts';
// Re-exported so hosts use the same SDK copy as the server.
export { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
