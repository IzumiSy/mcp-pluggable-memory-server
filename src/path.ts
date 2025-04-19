import { homedir } from "os";
import { join } from "path";

export const defaultAppDir = join(
  homedir(),
  ".local",
  "share",
  "duckdb-memory-server"
);

export const socketFileName = "db-server.sock";
