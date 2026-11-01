#!/usr/bin/env node
// `checkbox-mcp` executable: the Checkbox MCP server over stdio. In the monorepo the TypeScript sources run through
// tsx; a published build bundles src/bin.ts.
import { register } from 'tsx/esm/api';

register();
await import('../src/bin.ts');
