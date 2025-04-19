import { spawn } from "child_process";
import { PIDListManager } from "./pid";

export const startProcess = async (props: {
  path: string;
  pidListManager: PIDListManager;
  extraEnvs?: Record<string, string>;
  beforeSpawn?: () => Promise<void>;
  onError?: (err: Error) => Promise<void>;
}) => {
  await props.beforeSpawn?.();

  const serverProcess = spawn("node", [props.path], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...props.extraEnvs,
    },
  });

  serverProcess.on("error", async (err) => {
    await props.onError?.(err);
    await props.pidListManager.removePid();
    process.exit(1);
  });

  return serverProcess;
};
