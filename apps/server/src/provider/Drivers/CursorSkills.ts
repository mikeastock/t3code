/**
 * CursorSkills — filesystem discovery of Cursor Agent skills for the `$` picker.
 *
 * Cursor Agent has no `inspect` (or other) catalog command: `agent --help`,
 * `agent about --format json`, `agent plugin`, and ACP do not report skills.
 * A flat scan of `~/.cursor/skills` is not enough — that misses bundled
 * skills, plugin skills, and Cursor's compatibility roots. This module walks
 * the same SKILL.md trees Cursor loads, with YAML frontmatter parsed the way
 * ClaudeSkills does.
 *
 * Roots, lowest precedence first (later roots win on duplicate names):
 *
 * 1. bundled: `~/.cursor/skills-cursor`
 * 2. plugin cache: `~/.cursor/plugins/cache/<marketplace>/<plugin>/<sha>/skills`
 *    (marketplaces, plugins, then SHAs, each sorted; later SHA wins)
 * 3. local plugins: `~/.cursor/plugins/local/<plugin>/skills`
 * 4. user compatibility: `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`
 * 5. user: `~/.cursor/skills`
 * 6. project compatibility: `<cwd>/.claude/skills`, `<cwd>/.codex/skills`,
 *    `<cwd>/.agents/skills`
 * 7. project: `<cwd>/.cursor/skills`
 *
 * Each root is walked recursively so category folders work. Skill identity is
 * the folder that contains `SKILL.md`, not the category above it. `HOME` /
 * `USERPROFILE` select the user home so tests can isolate Cursor dirs.
 * `user-invocable: false` (or `userInvocable: false`) maps to `enabled: false`;
 * pickers already filter on `enabled`. Discovery is best-effort: missing
 * roots, unreadable files, or malformed frontmatter never degrade the probe.
 *
 * @module provider/Drivers/CursorSkills
 */
import * as NodeOS from "node:os";

import type { CursorSettings, ServerProviderSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { parse as parseYamlDocument } from "yaml";

type CursorSkillScope = "bundled" | "plugin" | "user" | "project";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SKILL_MARKDOWN = "SKILL.md";

type SkillFrontmatter =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" }
  | {
      readonly kind: "parsed";
      readonly name?: string;
      readonly description?: string;
      readonly enabled: boolean;
    };

function isUserInvocable(record: Record<string, unknown>): boolean {
  const value = record["user-invocable"] ?? record.userInvocable;
  return value !== false;
}

function parseSkillFrontmatter(contents: string): SkillFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) {
    return { kind: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    return { kind: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "malformed" };
  }

  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  return {
    kind: "parsed",
    enabled: isUserInvocable(record),
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

function resolveUserHome(environment: NodeJS.ProcessEnv): string {
  const fromEnvironment = environment.HOME?.trim() || environment.USERPROFILE?.trim() || "";
  return fromEnvironment.length > 0 ? fromEnvironment : NodeOS.homedir();
}

const listPluginSkillRoots = Effect.fn("listPluginSkillRoots")(function* (
  cursorHome: string,
): Effect.fn.Return<
  ReadonlyArray<{ directory: string; scope: CursorSkillScope }>,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const roots: Array<{ directory: string; scope: CursorSkillScope }> = [];

  const cacheRoot = path.join(cursorHome, "plugins", "cache");
  const marketplaces = yield* fileSystem
    .readDirectory(cacheRoot)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  for (const marketplace of [...marketplaces].sort()) {
    const marketplacePath = path.join(cacheRoot, marketplace);
    const plugins = yield* fileSystem
      .readDirectory(marketplacePath)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    for (const plugin of [...plugins].sort()) {
      const pluginPath = path.join(marketplacePath, plugin);
      const versions = yield* fileSystem
        .readDirectory(pluginPath)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      for (const version of [...versions].sort()) {
        roots.push({
          directory: path.join(pluginPath, version, "skills"),
          scope: "plugin",
        });
      }
    }
  }

  const localRoot = path.join(cursorHome, "plugins", "local");
  const localPlugins = yield* fileSystem
    .readDirectory(localRoot)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  for (const plugin of [...localPlugins].sort()) {
    roots.push({
      directory: path.join(localRoot, plugin, "skills"),
      scope: "plugin",
    });
  }

  return roots;
});

const scanSkillRoot = Effect.fn("scanSkillRoot")(function* (
  root: { directory: string; scope: CursorSkillScope },
  skillsByName: Map<string, ServerProviderSkill>,
): Effect.fn.Return<void, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fileSystem
    .readDirectory(root.directory, { recursive: true })
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

  for (const relative of [...entries].sort()) {
    if (path.basename(relative) !== SKILL_MARKDOWN) {
      continue;
    }
    const parentDir = path.dirname(relative);
    if (parentDir === "." || parentDir === "") {
      continue;
    }

    const skillPath = path.join(root.directory, relative);
    const contents = yield* fileSystem
      .readFileString(skillPath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (contents === undefined) {
      continue;
    }

    const frontmatter = parseSkillFrontmatter(contents);
    if (frontmatter.kind === "malformed") {
      continue;
    }

    const name =
      (frontmatter.kind === "parsed" ? frontmatter.name : undefined) ??
      path.basename(parentDir).trim();
    if (!name) {
      continue;
    }

    skillsByName.set(name, {
      name,
      path: skillPath,
      enabled: frontmatter.kind === "parsed" ? frontmatter.enabled : true,
      scope: root.scope,
      ...(frontmatter.kind === "parsed" && frontmatter.description
        ? { description: frontmatter.description }
        : {}),
    });
  }
});

/**
 * Enumerate Cursor skills from bundled, plugin, user, and project roots.
 * Never fails: any filesystem error resolves to an empty list.
 */
export const discoverCursorSkills = Effect.fn("discoverCursorSkills")(function* (
  _cursorSettings: Pick<CursorSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  return yield* Effect.gen(function* () {
    const path = yield* Path.Path;
    const home = resolveUserHome(environment);
    const cursorHome = path.join(home, ".cursor");
    const pluginRoots = yield* listPluginSkillRoots(cursorHome);

    const roots: ReadonlyArray<{ directory: string; scope: CursorSkillScope }> = [
      { directory: path.join(cursorHome, "skills-cursor"), scope: "bundled" },
      ...pluginRoots,
      { directory: path.join(home, ".claude", "skills"), scope: "user" },
      { directory: path.join(home, ".codex", "skills"), scope: "user" },
      { directory: path.join(home, ".agents", "skills"), scope: "user" },
      { directory: path.join(cursorHome, "skills"), scope: "user" },
      ...(cwd
        ? [
            { directory: path.join(cwd, ".claude", "skills"), scope: "project" as const },
            { directory: path.join(cwd, ".codex", "skills"), scope: "project" as const },
            { directory: path.join(cwd, ".agents", "skills"), scope: "project" as const },
            { directory: path.join(cwd, ".cursor", "skills"), scope: "project" as const },
          ]
        : []),
    ];

    const skillsByName = new Map<string, ServerProviderSkill>();
    for (const root of roots) {
      yield* scanSkillRoot(root, skillsByName);
    }

    return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
  }).pipe(Effect.orElseSucceed((): ReadonlyArray<ServerProviderSkill> => []));
});
