import * as fs from 'fs';
import * as path from 'path';

export interface AuditEntry {
  timestamp: string;
  kind: 'command' | 'file_write' | 'file_delete' | 'permission_elevation' | 'config_change';
  detail: string;
  risk?: string;
  authorized: boolean;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  private logPath: string;
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly MAX_ARCHIVES = 3;

  constructor(storagePath: string) {
    this.logPath = path.join(storagePath, 'audit.jsonl');
    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    } catch {
      /* ignore */
    }
    // Set periodic check timer. Use 30s.
    this.flushTimer = setInterval(() => this.checkRotation(), 30_000).unref();
  }

  private checkRotation(): void {
    try {
      if (fs.existsSync(this.logPath) && fs.statSync(this.logPath).size >= this.MAX_FILE_SIZE) {
        this.rotate();
      }
    } catch {
      /* file doesn't exist yet or stat fails */
    }
  }

  private rotate(): void {
    try {
      const dir = path.dirname(this.logPath);
      const oldest = path.join(dir, `audit.${this.MAX_ARCHIVES}.jsonl`);
      if (fs.existsSync(oldest)) {
        fs.unlinkSync(oldest);
      }
      for (let i = this.MAX_ARCHIVES - 1; i >= 1; i--) {
        const src = path.join(dir, `audit.${i}.jsonl`);
        if (fs.existsSync(src)) {
          fs.renameSync(src, path.join(dir, `audit.${i + 1}.jsonl`));
        }
      }
      if (fs.existsSync(this.logPath)) {
        fs.renameSync(this.logPath, path.join(dir, 'audit.1.jsonl'));
      }
    } catch {
      /* rotation failure shouldn't crash the extension */
    }
  }

  record(entry: Omit<AuditEntry, 'timestamp'>): void {
    const fullEntry: AuditEntry = { timestamp: new Date().toISOString(), ...entry };
    this.entries.push(fullEntry);
    if (this.entries.length > 1000) {
      this.entries.shift();
    }
    try {
      this.checkRotation();
      fs.appendFileSync(this.logPath, JSON.stringify(fullEntry) + '\n');
    } catch {
      /* ignore write failure */
    }
  }

  dump(): AuditEntry[] {
    return [...this.entries];
  }

  readAll(): AuditEntry[] {
    try {
      if (!fs.existsSync(this.logPath)) return [...this.entries];
      const content = fs.readFileSync(this.logPath, 'utf-8').trim();
      if (!content) return [...this.entries];
      return content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      return [...this.entries];
    }
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }
}
