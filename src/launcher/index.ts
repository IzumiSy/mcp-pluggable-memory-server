#!/usr/bin/env node
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { startProcess, StartProcessProps } from "./server";
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

const checkDBServerHealth = () =>
  healthCheckClient.healthcheck
    .query()
    .then((r) => r === "ok")
    .catch(() => false);

const startDBServer = async (props: {
  onError?: StartProcessProps["onError"];
}) => {
  const start = async () => {
    const dbServerProcess = await startProcess({
      path: "../db-server/index.mjs",
      extraEnvs: {
        MEMORY_FILE_PATH: process.env.MEMORY_FILE_PATH ?? "",
      },
      onError: props.onError,

      // Delete the socket file if it exists before starting the server
      beforeSpawn: async () => deleteSocketFile(),
    });

    const kill = async () => {
      dbServerProcess?.kill();
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
  const pidListManager = new PIDListManager({
    onNoActivePids: deleteSocketFile,
  });

  try {
    if (!existsSync(defaultAppDir)) {
      mkdirSync(defaultAppDir, { recursive: true });
    }

    await pidListManager.addPid();

    const dbProcess = await startDBServer({
      onError: async () => {
        await pidListManager.removePid();
      },
    });
    const mcpProcess = await startProcess({
      path: "../client/index.mjs",
      onError: async () => {
        await pidListManager.removePid();
      },
    });

    mcpProcess.on("exit", async () => {
      await pidListManager.removePid();
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
