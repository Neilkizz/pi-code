import * as fs from 'fs';
import * as path from 'path';

export interface AuditEntry {
  timestamp?: string;
  kind: string;
  detail: string;
  risk?: string;
  authorized?: boolean;
}

export class AuditLog {
  private logPath: string;
  private memoryLogs: AuditEntry[] = [];
  private maxMemory: number = 1000;
  private MAX_FILE_SIZE: number = 10 * 1024 * 1024; // 10MB default
  private MAX_ARCHIVES: number = 5;
  public flushTimer: undefined = undefined;

  constructor(filePath: string) {
    this.logPath = filePath;
  }

  record(entry: AuditEntry): void {
    const fullEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.memoryLogs.push(fullEntry);
    if (this.memoryLogs.length > this.maxMemory) {
      this.memoryLogs.shift();
    }

    this.persistSync(fullEntry);
  }

  dump(): AuditEntry[] {
    return [...this.memoryLogs];
  }

  readAll(): AuditEntry[] {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }
    const content = fs.readFileSync(this.logPath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    return lines.map((line) => JSON.parse(line));
  }

  private persistSync(entry: AuditEntry): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.logPath)) {
      const stats = fs.statSync(this.logPath);
      if (stats.size >= this.MAX_FILE_SIZE) {
        this.rotateSync();
      }
    }

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.logPath, line, 'utf8');
  }

  private rotateSync(): void {
    for (let i = this.MAX_ARCHIVES - 1; i >= 1; i--) {
      const currentArchive = `${this.logPath}.${i}`;
      const nextArchive = `${this.logPath}.${i + 1}`;
      if (fs.existsSync(currentArchive)) {
        if (i === this.MAX_ARCHIVES - 1) {
          fs.unlinkSync(currentArchive);
        } else {
          fs.renameSync(currentArchive, nextArchive);
        }
      }
    }

    if (fs.existsSync(this.logPath)) {
      fs.renameSync(this.logPath, `${this.logPath}.1`);
    }
  }

  dispose(): void {
    // No background timer to clear
  }
}
