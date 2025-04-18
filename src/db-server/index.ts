import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import { defaultSocketPath } from "../client/index";
import { appRouter } from "./handlers";

const server = Fastify();
server.register(fastifyTRPCPlugin, {
  trpcOptions: {
    router: appRouter,
  },
});

const socketFilePath = process.env.SOCKET_PATH ?? defaultSocketPath;
const socketDir = join(homedir(), ".local", "share", "duckdb-memory-server");

(async () => {
  try {
    if (!existsSync(socketDir)) {
      mkdirSync(socketDir, { recursive: true });
    }

    await server.listen({ path: socketFilePath });
  } catch (err) {
    process.exit(1);
  }
})();
