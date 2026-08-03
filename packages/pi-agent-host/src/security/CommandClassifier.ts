export type CommandRiskLevel = 'safe' | 'read-only' | 'mutation' | 'destructive' | 'forbidden';

export class CommandClassifier {
  classify(cmd: string): CommandRiskLevel {
    const trimmed = cmd.trim();
    if (/rm\s+-rf\s+\/|mkfs|dd\s+if=/.test(trimmed)) return 'destructive';
    if (/^(ls|cat|find|pwd|git\s+status|git\s+log|echo)/.test(trimmed)) return 'read-only';
    if (/^(git\s+commit|git\s+push|mkdir|touch|cp|mv)/.test(trimmed)) return 'mutation';
    return 'safe';
  }
}
