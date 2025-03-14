import { Server } from "@modelcontextprotocol/sdk/server/index.js";

// アプリケーション内で使用するログレベル
export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warning",
  ERROR = "error",
}

// LogLevelからMcpLogLevelへの変換マップ
const logLevelToMcpLogLevel = {
  [LogLevel.DEBUG]: "debug",
  [LogLevel.INFO]: "info",
  [LogLevel.WARN]: "warning",
  [LogLevel.ERROR]: "error",
} as const;

// 文字列からLogLevelへの変換関数
export function stringToLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case "debug":
      return LogLevel.DEBUG;
    case "info":
      return LogLevel.INFO;
    case "warning":
    case "warn":
      return LogLevel.WARN;
    case "error":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO; // デフォルトはINFO
  }
}

// ログデータの型定義
export interface LogData {
  message: string;
  payload?: Record<string, unknown>;
}

// Nullロガー
export class NullLogger implements Logger {
  debug(message: string, payload?: Record<string, unknown>): void {
    // No-op
  }

  info(message: string, payload?: Record<string, unknown>): void {
    // No-op
  }

  warn(message: string, payload?: Record<string, unknown>): void {
    // No-op
  }

  error(message: string, payload?: Record<string, unknown>): void {
    // No-op
  }

  setLevel(level: LogLevel): void {
    // No-op
  }
}

// 抽象ロガーインターフェース
export interface Logger {
  debug(message: string, payload?: Record<string, unknown>): void;
  info(message: string, payload?: Record<string, unknown>): void;
  warn(message: string, payload?: Record<string, unknown>): void;
  error(message: string, payload?: Record<string, unknown>): void;
  setLevel(level: LogLevel): void;
}

// コンソールロガー（デフォルト実装として）
export class ConsoleLogger implements Logger {
  private level: LogLevel = LogLevel.INFO;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, payload?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(message, payload);
    }
  }

  info(message: string, payload?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(message, payload);
    }
  }

  warn(message: string, payload?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(message, payload);
    }
  }

  error(message: string, payload?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(message, payload);
    }
  }

  private shouldLog(messageLevel: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
    ];
    return levels.indexOf(messageLevel) >= levels.indexOf(this.level);
  }
}
