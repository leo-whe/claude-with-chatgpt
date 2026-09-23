import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStateDir } from "./paths.js";

export interface SandboxAllowResult {
  added: boolean;
  alreadyAllowed: boolean;
  stateDir: string;
  configPath: string;
}

/** Claude Code's own config home, following its CLAUDE_CONFIG_DIR override. */
export function getClaudeConfigHome(): string {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".claude");
}

export function getClaudeSettingsPath(): string {
  return path.join(getClaudeConfigHome(), "settings.json");
}

/** Absolute path to this checkout's CLI entrypoint, used to scope the allow rule. */
export function bridgeBinPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "c2g.js");
}

/**
 * Permission rules that let the Skill run bridge commands without a prompt
 * each time: one scoped to this exact checkout's entrypoint (dev / local
 * clone), one for a globally linked `c2g` binary.
 */
export function allowRulesFor(binPath: string): string[] {
  return [`Bash(node ${binPath} *)`, "Bash(c2g *)"];
}

export function isBridgeAllowlisted(content: string, binPath: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content || "{}");
  } catch {
    return false;
  }
  const allow = (parsed as { permissions?: { allow?: unknown } })?.permissions?.allow;
  if (!Array.isArray(allow)) return false;
  return allowRulesFor(binPath).every((rule) => allow.includes(rule));
}

/**
 * Idempotently add this bridge's CLI to Claude Code's permissions.allow list
 * (user-level settings.json) so later Skill runs do not need elevation.
 * Never touches any other key in the file.
 */
export function ensureSandboxAllowlist(opts?: {
  configPath?: string;
  stateDir?: string;
  binPath?: string;
}): SandboxAllowResult {
  const stateDir = path.resolve(opts?.stateDir ?? getStateDir());
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  const configPath = opts?.configPath ?? getClaudeSettingsPath();
  const binPath = opts?.binPath ?? bridgeBinPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });

  const previousRaw = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  if (isBridgeAllowlisted(previousRaw, binPath)) {
    return { added: false, alreadyAllowed: true, stateDir, configPath };
  }

  let previous: Record<string, unknown>;
  try {
    previous = previousRaw.trim() ? (JSON.parse(previousRaw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`${configPath} is not valid JSON; fix or remove it before retrying`);
  }

  const permissions = (previous.permissions as { allow?: unknown } | undefined) ?? {};
  const existingAllow = Array.isArray(permissions.allow) ? (permissions.allow as string[]) : [];
  const rules = allowRulesFor(binPath);
  const missing = rules.filter((rule) => !existingAllow.includes(rule));

  const next = {
    ...previous,
    permissions: { ...permissions, allow: [...existingAllow, ...missing] },
  };
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Windows / filesystems without chmod semantics
  }
  return { added: true, alreadyAllowed: false, stateDir, configPath };
}
