import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { discoverCursorSkills } from "./CursorSkills.ts";

const writeSkill = Effect.fn(function* (
  skillsDir: string,
  directoryName: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillDir = path.join(skillsDir, directoryName);
  yield* fs.makeDirectory(skillDir, { recursive: true });
  yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), contents);
});

const skillMarkdown = (fields: {
  readonly name?: string;
  readonly description?: string;
  readonly userInvocable?: boolean;
}) => {
  const lines = ["---"];
  if (fields.name !== undefined) {
    lines.push(`name: ${fields.name}`);
  }
  if (fields.description !== undefined) {
    lines.push(`description: ${fields.description}`);
  }
  if (fields.userInvocable !== undefined) {
    lines.push(`user-invocable: ${fields.userInvocable}`);
  }
  lines.push("---", "", "# Body");
  return lines.join("\n");
};

it.layer(NodeServices.layer)("discoverCursorSkills", (it) => {
  it.effect("discovers user, project, and plugin skills with frontmatter metadata", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const home = path.join(tempDir, "home");
      const workspace = path.join(tempDir, "workspace");
      const pluginSkills = path.join(
        home,
        ".cursor",
        "plugins",
        "cache",
        "cursor-public",
        "team-kit",
        "abc123",
        "skills",
      );

      yield* writeSkill(
        path.join(home, ".cursor", "skills"),
        "writing-docs",
        skillMarkdown({ name: "writing-docs", description: "Write user docs." }),
      );
      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "deploy",
        skillMarkdown({ name: "deploy", description: "Deploy the app." }),
      );
      yield* writeSkill(
        pluginSkills,
        "fix-ci",
        skillMarkdown({ name: "fix-ci", description: "Fix CI." }),
      );

      const skills = yield* discoverCursorSkills(
        { binaryPath: "cursor-agent" },
        { HOME: home },
        workspace,
      );

      assert.deepEqual(skills, [
        {
          name: "deploy",
          path: path.join(workspace, ".cursor", "skills", "deploy", "SKILL.md"),
          enabled: true,
          scope: "project",
          description: "Deploy the app.",
        },
        {
          name: "fix-ci",
          path: path.join(pluginSkills, "fix-ci", "SKILL.md"),
          enabled: true,
          scope: "plugin",
          description: "Fix CI.",
        },
        {
          name: "writing-docs",
          path: path.join(home, ".cursor", "skills", "writing-docs", "SKILL.md"),
          enabled: true,
          scope: "user",
          description: "Write user docs.",
        },
      ]);
    }),
  );

  it.effect("prefers project over user over plugin over bundled on name collisions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const home = path.join(tempDir, "home");
      const workspace = path.join(tempDir, "workspace");

      yield* writeSkill(
        path.join(home, ".cursor", "skills-cursor"),
        "deploy",
        skillMarkdown({ name: "deploy", description: "Bundled deploy." }),
      );
      yield* writeSkill(
        path.join(home, ".cursor", "plugins", "cache", "cursor-public", "kit", "sha1", "skills"),
        "deploy",
        skillMarkdown({ name: "deploy", description: "Plugin deploy." }),
      );
      yield* writeSkill(
        path.join(home, ".cursor", "skills"),
        "deploy",
        skillMarkdown({ name: "deploy", description: "User deploy." }),
      );
      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "deploy",
        skillMarkdown({ name: "deploy", description: "Project deploy." }),
      );

      const skills = yield* discoverCursorSkills(
        { binaryPath: "cursor-agent" },
        { HOME: home },
        workspace,
      );

      assert.equal(skills.length, 1);
      assert.equal(skills[0]?.scope, "project");
      assert.equal(skills[0]?.description, "Project deploy.");
    }),
  );

  it.effect("prefers a later plugin SHA, then local plugins, over an earlier cache SHA", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const home = path.join(tempDir, "home");

      yield* writeSkill(
        path.join(home, ".cursor", "plugins", "cache", "cursor-public", "kit", "aaa", "skills"),
        "review",
        skillMarkdown({ name: "review", description: "Old cache." }),
      );
      yield* writeSkill(
        path.join(home, ".cursor", "plugins", "cache", "cursor-public", "kit", "zzz", "skills"),
        "review",
        skillMarkdown({ name: "review", description: "New cache." }),
      );
      yield* writeSkill(
        path.join(home, ".cursor", "plugins", "local", "kit", "skills"),
        "review",
        skillMarkdown({ name: "review", description: "Local plugin." }),
      );

      const skills = yield* discoverCursorSkills({ binaryPath: "cursor-agent" }, { HOME: home });

      assert.deepEqual(skills, [
        {
          name: "review",
          path: path.join(
            home,
            ".cursor",
            "plugins",
            "local",
            "kit",
            "skills",
            "review",
            "SKILL.md",
          ),
          enabled: true,
          scope: "plugin",
          description: "Local plugin.",
        },
      ]);
    }),
  );

  it.effect("disables skills marked user-invocable false and keeps them in the catalog", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const home = path.join(tempDir, "home");

      yield* writeSkill(
        path.join(home, ".cursor", "skills"),
        "internal-helper",
        skillMarkdown({ name: "internal-helper", userInvocable: false }),
      );

      const skills = yield* discoverCursorSkills({ binaryPath: "cursor-agent" }, { HOME: home });

      assert.deepEqual(skills, [
        {
          name: "internal-helper",
          path: path.join(home, ".cursor", "skills", "internal-helper", "SKILL.md"),
          enabled: false,
          scope: "user",
        },
      ]);
    }),
  );

  it.effect("walks nested category folders and falls back to the directory name", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const home = path.join(tempDir, "home");
      const nested = path.join(home, ".cursor", "skills", "shipping", "land-it");
      yield* fs.makeDirectory(nested, { recursive: true });
      yield* fs.writeFileString(path.join(nested, "SKILL.md"), "# Just a heading\n");

      const skills = yield* discoverCursorSkills({ binaryPath: "cursor-agent" }, { HOME: home });

      assert.deepEqual(skills, [
        {
          name: "land-it",
          path: path.join(nested, "SKILL.md"),
          enabled: true,
          scope: "user",
        },
      ]);
    }),
  );

  it.effect("skips malformed frontmatter and non-skill files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const home = path.join(tempDir, "home");
      const skillsDir = path.join(home, ".cursor", "skills");

      yield* writeSkill(skillsDir, "broken-yaml", "---\nname: [unclosed\n---\n");
      yield* fs.makeDirectory(skillsDir, { recursive: true });
      yield* fs.writeFileString(path.join(skillsDir, "README.md"), "not a skill");
      yield* fs.writeFileString(path.join(skillsDir, "SKILL.md"), "---\nname: stray-root\n---\n");

      const skills = yield* discoverCursorSkills({ binaryPath: "cursor-agent" }, { HOME: home });

      assert.deepEqual(skills, []);
    }),
  );

  it.effect("does not treat nested plugin automation skills as the plugin catalog", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const home = path.join(tempDir, "home");
      const pluginRoot = path.join(
        home,
        ".cursor",
        "plugins",
        "cache",
        "cursor-public",
        "pstack",
        "sha1",
      );

      yield* writeSkill(
        path.join(pluginRoot, "skills"),
        "ship",
        skillMarkdown({ name: "ship", description: "Ship it." }),
      );
      yield* writeSkill(
        path.join(pluginRoot, "automations", "benny", "skills"),
        "triage",
        skillMarkdown({ name: "triage", description: "Not a top-level plugin skill." }),
      );

      const skills = yield* discoverCursorSkills({ binaryPath: "cursor-agent" }, { HOME: home });

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["ship"],
      );
    }),
  );

  it.effect("loads Cursor compatibility roots and prefers .cursor over .agents", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const home = path.join(tempDir, "home");
      const workspace = path.join(tempDir, "workspace");

      yield* writeSkill(
        path.join(home, ".agents", "skills"),
        "review",
        skillMarkdown({ name: "review", description: "User agents." }),
      );
      yield* writeSkill(
        path.join(workspace, ".agents", "skills"),
        "review",
        skillMarkdown({ name: "review", description: "Project agents." }),
      );
      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "review",
        skillMarkdown({ name: "review", description: "Project cursor." }),
      );

      const skills = yield* discoverCursorSkills(
        { binaryPath: "cursor-agent" },
        { HOME: home },
        workspace,
      );

      assert.equal(skills.length, 1);
      assert.equal(skills[0]?.description, "Project cursor.");
      assert.equal(skills[0]?.scope, "project");
    }),
  );

  it.effect("omits project skills when cwd is not provided", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const home = path.join(tempDir, "home");
      const workspace = path.join(tempDir, "workspace");

      yield* writeSkill(
        path.join(home, ".cursor", "skills"),
        "personal",
        skillMarkdown({ name: "personal" }),
      );
      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "project-only",
        skillMarkdown({ name: "project-only" }),
      );

      const skills = yield* discoverCursorSkills({ binaryPath: "cursor-agent" }, { HOME: home });

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["personal"],
      );
    }),
  );

  it.effect("returns an empty list when no skill roots exist", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });

      const skills = yield* discoverCursorSkills(
        { binaryPath: "cursor-agent" },
        { HOME: path.join(tempDir, "missing-home") },
        path.join(tempDir, "missing-workspace"),
      );

      assert.deepEqual(skills, []);
    }),
  );

  it.effect("uses USERPROFILE when HOME is unset", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" });
      const home = path.join(tempDir, "windows-home");

      yield* writeSkill(
        path.join(home, ".cursor", "skills"),
        "windows-skill",
        skillMarkdown({ name: "windows-skill" }),
      );

      const skills = yield* discoverCursorSkills(
        { binaryPath: "cursor-agent" },
        { USERPROFILE: home },
      );

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["windows-skill"],
      );
    }),
  );
});
