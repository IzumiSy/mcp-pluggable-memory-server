import { initTRPC } from "@trpc/server";
import { homedir } from "os";
import { join } from "path";
import { NullLogger } from "./logger";
import { existsSync, mkdirSync } from "fs";
import { DuckDBKnowledgeGraphManager } from "./manager";

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure.use((opts) => {
  const defaultDir = join(homedir(), ".local", "share", "duckdb-memory-server");
  const logger = new NullLogger();

  return opts.next({
    ctx: {
      manager: new DuckDBKnowledgeGraphManager(() => {
        const defaultPath = join(defaultDir, "knowledge-graph.data");
        if (!existsSync(defaultDir)) {
          mkdirSync(defaultDir, { recursive: true });
        }

        return process.env.MEMORY_FILE_PATH || defaultPath;
      }, logger),
    },
  });
});
