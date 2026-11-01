#!/usr/bin/env node
// The `checkbox-mcp` executable (package.json "bin").
import { runStdio } from './stdio.ts';

runStdio().catch((err: unknown) => {
  process.stderr.write(`checkbox-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
