import { initTRPC } from "@trpc/server";
import { Logger } from "./logger";
import { existsSync } from "fs";
import { DuckDBKnowledgeGraphManager } from "./manager";

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure.use((opts) => {
  const logger = new Logger();
  const memoryFilePath = process.env.MEMORY_FILE_PATH;
  if (!memoryFilePath || !existsSync(memoryFilePath)) {
    throw new Error("Memory file path does not exist.");
  }

  return opts.next({
    ctx: {
      manager: new DuckDBKnowledgeGraphManager(() => memoryFilePath, logger),
    },
  });
});
