#!/usr/bin/env node
import { existsSync, unlinkSync } from "fs";
import { startProcess } from "./server";
import { createTRPCClient, httpBatchLink, retryLink } from "@trpc/client";
import { AppRouter } from "../db-server/handlers";
import { PIDListManager } from "./pid";
import { defaultAppDir, socketFileName } from "../path";
import { join } from "path";

const socketFilePath = join(defaultAppDir, socketFileName);
const healthCheckClient = createTRPCClient<AppRouter>({
  links: [
    retryLink({
      retry: ({ attempts }) => attempts <= 3,
      retryDelayMs: () => 500,
    }),
    httpBatchLink({
      url: socketFilePath,
    }),
  ],
});

const deleteSocketFile = () => {
  if (existsSync(socketFilePath)) {
    unlinkSync(socketFilePath);
  }
};

const pidListManager = new PIDListManager({
  appDir: defaultAppDir,
  onNoActivePids: deleteSocketFile,
});

const checkDBServerHealth = () =>
  healthCheckClient.healthcheck
    .query()
    .then((r) => r === "ok")
    .catch(() => false);

const startDBServer = async () => {
  const start = async () => {
    const dbServerProcess = await startProcess({
      path: "../db-server/index.mjs",
      extraEnvs: {
        MEMORY_FILE_PATH: process.env.MEMORY_FILE_PATH ?? "",
      },
      pidListManager,

      // Delete the socket file if it exists before starting the server
      beforeSpawn: async () => deleteSocketFile(),
    });

    const kill = async () => {
      dbServerProcess?.kill();
      await pidListManager.removePid();
    };

    return {
      process: dbServerProcess,
      kill,
      waitUp: async () => {
        const isHealthy = await checkDBServerHealth();
        if (isHealthy) {
          return;
        }
        await kill();
      },
    };
  };

  if (!existsSync(socketFilePath)) {
    return start();
  }

  const isDBServerHealthy = await checkDBServerHealth();
  if (!isDBServerHealthy) {
    const server = await start();
    await server.waitUp();
    return server;
  }

  return null;
};

(async () => {
  try {
    await pidListManager.addPid();

    const dbProcess = await startDBServer();
    const mcpProcess = await startProcess({
      path: "../client/index.mjs",
      pidListManager,
    });

    mcpProcess.on("exit", async () => {
      await dbProcess?.kill();
    });

    const cleanup = () => {
      mcpProcess.kill();
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  } catch {
    await pidListManager.removePid();
  }
})();
