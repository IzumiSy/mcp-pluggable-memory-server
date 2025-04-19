export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warning",
  ERROR = "error",
}

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
      return LogLevel.INFO;
  }
}

export interface LogData {
  message: string;
  payload?: Record<string, unknown>;
}

export class Logger {
  protected level: LogLevel = LogLevel.INFO;

  protected setLevel(level: LogLevel): void {
    this.level = level;
  }

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

  protected shouldLog(messageLevel: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
    ];
    return levels.indexOf(messageLevel) >= levels.indexOf(this.level);
  }
}

export class ConsoleLogger extends Logger {
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
}
