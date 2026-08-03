export class EnvInheritance {
  static filterEnv(env: Record<string, string | undefined>): Record<string, string> {
    const sensitiveKeys = ['AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'GITHUB_TOKEN', 'PI_SECRET_KEY'];
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (v !== undefined && !sensitiveKeys.includes(k)) {
        result[k] = v;
      }
    }
    return result;
  }
}
