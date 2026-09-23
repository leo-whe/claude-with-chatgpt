import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { allowRulesFor, ensureSandboxAllowlist, isBridgeAllowlisted } from "../src/config/sandbox-allow.js";
import { makeTmpDir, cleanup } from "./helpers.js";

const BIN_PATH = "/home/ada/claude-with-chatgpt/bin/c2g.js";

describe("sandbox allowlist", () => {
  it("creates settings.json when it is missing", () => {
    const dir = makeTmpDir("sandbox-missing");
    const stateDir = path.join(dir, "state");
    const configPath = path.join(dir, "settings.json");
    const result = ensureSandboxAllowlist({ configPath, stateDir, binPath: BIN_PATH });
    expect(result.added).toBe(true);
    const text = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(text);
    expect(parsed.permissions.allow).toEqual(expect.arrayContaining(allowRulesFor(BIN_PATH)));
    expect(isBridgeAllowlisted(text, BIN_PATH)).toBe(true);
    cleanup(dir);
  });

  it("merges into an existing settings.json without rewriting unrelated keys", () => {
    const dir = makeTmpDir("sandbox-merge");
    const stateDir = path.join(dir, "state");
    const configPath = path.join(dir, "settings.json");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        { model: "sonnet", theme: "dark", permissions: { allow: ["Bash(git *)"], deny: ["Bash(rm -rf *)"] } },
        null,
        2
      )
    );
    const result = ensureSandboxAllowlist({ configPath, stateDir, binPath: BIN_PATH });
    expect(result.added).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.model).toBe("sonnet");
    expect(parsed.theme).toBe("dark");
    expect(parsed.permissions.deny).toEqual(["Bash(rm -rf *)"]);
    expect(parsed.permissions.allow).toEqual(expect.arrayContaining(["Bash(git *)", ...allowRulesFor(BIN_PATH)]));
    cleanup(dir);
  });

  it("is idempotent once the rules are present", () => {
    const dir = makeTmpDir("sandbox-idem");
    const stateDir = path.join(dir, "state");
    const configPath = path.join(dir, "settings.json");
    const first = ensureSandboxAllowlist({ configPath, stateDir, binPath: BIN_PATH });
    const second = ensureSandboxAllowlist({ configPath, stateDir, binPath: BIN_PATH });
    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
    expect(second.alreadyAllowed).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.permissions.allow.filter((r: string) => r === "Bash(c2g *)").length).toBe(1);
    cleanup(dir);
  });

  it("throws a clear error on invalid JSON instead of clobbering the file", () => {
    const dir = makeTmpDir("sandbox-invalid");
    const stateDir = path.join(dir, "state");
    const configPath = path.join(dir, "settings.json");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, "{ not valid json");
    expect(() => ensureSandboxAllowlist({ configPath, stateDir, binPath: BIN_PATH })).toThrow(/not valid JSON/);
    cleanup(dir);
  });
});
