import { describe, expect, mock, test } from "bun:test"
import { Project } from "../../src/project/project"
import { Log } from "../../src/util/log"
import { $ } from "bun"
import path from "path"
import * as fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { GlobalBus } from "../../src/bus/global"

Log.init({ print: false })

const gitModule = await import("../../src/util/git")
const originalGit = gitModule.git

type Mode = "none" | "rev-list-fail" | "top-fail" | "common-dir-fail"
let mode: Mode = "none"

mock.module("../../src/util/git", () => ({
  git: (args: string[], opts: { cwd: string; env?: Record<string, string> }) => {
    const cmd = ["git", ...args].join(" ")
    if (
      mode === "rev-list-fail" &&
      cmd.includes("git rev-list") &&
      cmd.includes("--max-parents=0") &&
      cmd.includes("--all")
    ) {
      return Promise.resolve({
        exitCode: 128,
        text: () => Promise.resolve(""),
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    if (mode === "top-fail" && cmd.includes("git rev-parse") && cmd.includes("--show-toplevel")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => Promise.resolve(""),
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    if (mode === "common-dir-fail" && cmd.includes("git rev-parse") && cmd.includes("--git-common-dir")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => Promise.resolve(""),
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    return originalGit(args, opts)
  },
}))

async function withMode(next: Mode, run: () => Promise<void>) {
  const prev = mode
  mode = next
  try {
    await run()
  } finally {
    mode = prev
  }
}

async function loadProject() {
  return (await import("../../src/project/project")).Project
}

describe("Project.fromDirectory", () => {
  test("should handle git repository with no commits", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    const { project } = await p.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).toBe("global")
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    const fileExists = await Bun.file(opencodeFile).exists()
    expect(fileExists).toBe(false)
  })

  test("should handle git repository with commits", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const { project } = await p.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).not.toBe("global")
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    const fileExists = await Bun.file(opencodeFile).exists()
    expect(fileExists).toBe(true)
  })

  test("keeps git vcs when rev-list exits non-zero with empty output", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    await withMode("rev-list-fail", async () => {
      const { project } = await p.fromDirectory(tmp.path)
      expect(project.vcs).toBe("git")
      expect(project.id).toBe("global")
      expect(project.worktree).toBe(tmp.path)
    })
  })

  test("keeps git vcs when show-toplevel exits non-zero with empty output", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    await withMode("top-fail", async () => {
      const { project, sandbox } = await p.fromDirectory(tmp.path)
      expect(project.vcs).toBe("git")
      expect(project.worktree).toBe(tmp.path)
      expect(sandbox).toBe(tmp.path)
    })
  })

  test("keeps git vcs when git-common-dir exits non-zero with empty output", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    await withMode("common-dir-fail", async () => {
      const { project, sandbox } = await p.fromDirectory(tmp.path)
      expect(project.vcs).toBe("git")
      expect(project.worktree).toBe(tmp.path)
      expect(sandbox).toBe(tmp.path)
    })
  })
})

describe("Project.fromDirectory with worktrees", () => {
  test("should set worktree to root when called from root", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const { project, sandbox } = await p.fromDirectory(tmp.path)

    expect(project.worktree).toBe(tmp.path)
    expect(sandbox).toBe(tmp.path)
    expect(project.sandboxes).not.toContain(tmp.path)
  })

  test("should set worktree to root when called from a worktree", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-worktree")
    try {
      await $`git worktree add ${worktreePath} -b test-branch-${Date.now()}`.cwd(tmp.path).quiet()

      const { project, sandbox } = await p.fromDirectory(worktreePath)

      expect(project.worktree).toBe(tmp.path)
      expect(sandbox).toBe(worktreePath)
      expect(project.sandboxes).toContain(worktreePath)
      expect(project.sandboxes).not.toContain(tmp.path)
    } finally {
      await $`git worktree remove ${worktreePath}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })

  test("should accumulate multiple worktrees in sandboxes", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const worktree1 = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt1")
    const worktree2 = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt2")
    try {
      await $`git worktree add ${worktree1} -b branch-${Date.now()}`.cwd(tmp.path).quiet()
      await $`git worktree add ${worktree2} -b branch-${Date.now() + 1}`.cwd(tmp.path).quiet()

      await p.fromDirectory(worktree1)
      const { project } = await p.fromDirectory(worktree2)

      expect(project.worktree).toBe(tmp.path)
      expect(project.sandboxes).toContain(worktree1)
      expect(project.sandboxes).toContain(worktree2)
      expect(project.sandboxes).not.toContain(tmp.path)
    } finally {
      await $`git worktree remove ${worktree1}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
      await $`git worktree remove ${worktree2}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })
})

describe("Project.scan", () => {
  test("should discover git repos in a directory", async () => {
    await using tmp = await tmpdir()

    // Create two git repos inside the base directory
    const repo1 = path.join(tmp.path, "repo1")
    const repo2 = path.join(tmp.path, "repo2")
    await fs.mkdir(repo1, { recursive: true })
    await fs.mkdir(repo2, { recursive: true })

    await $`git init`.cwd(repo1).quiet()
    await $`git commit --allow-empty -m "root commit 1"`.cwd(repo1).quiet()
    await $`git init`.cwd(repo2).quiet()
    await $`git commit --allow-empty -m "root commit 2"`.cwd(repo2).quiet()

    const projects = await Project.scan([tmp.path])

    expect(projects.length).toBe(2)
    const worktrees = projects.map((p) => p.worktree).sort()
    expect(worktrees).toContain(repo1)
    expect(worktrees).toContain(repo2)
  })

  test("should skip node_modules directories", async () => {
    await using tmp = await tmpdir()

    // Create a normal repo and one inside node_modules
    const repo = path.join(tmp.path, "real-repo")
    const nmRepo = path.join(tmp.path, "node_modules", "some-pkg")
    await fs.mkdir(repo, { recursive: true })
    await fs.mkdir(nmRepo, { recursive: true })

    await $`git init`.cwd(repo).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(repo).quiet()
    await $`git init`.cwd(nmRepo).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(nmRepo).quiet()

    const projects = await Project.scan([tmp.path])

    expect(projects.length).toBe(1)
    expect(projects[0].worktree).toBe(repo)
  })

  test("should skip repos without commits", async () => {
    await using tmp = await tmpdir()

    const committed = path.join(tmp.path, "committed")
    const empty = path.join(tmp.path, "empty")
    await fs.mkdir(committed, { recursive: true })
    await fs.mkdir(empty, { recursive: true })

    await $`git init`.cwd(committed).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(committed).quiet()
    await $`git init`.cwd(empty).quiet()

    const projects = await Project.scan([tmp.path])

    // Only the committed repo should appear (empty returns "global" which is filtered)
    expect(projects.length).toBe(1)
    expect(projects[0].worktree).toBe(committed)
  })

  test("should return empty for directory with no git repos", async () => {
    await using tmp = await tmpdir()

    await fs.mkdir(path.join(tmp.path, "just-a-folder"), { recursive: true })
    await Bun.write(path.join(tmp.path, "file.txt"), "hello")

    const projects = await Project.scan([tmp.path])

    expect(projects.length).toBe(0)
  })

  test("should find nested git repos", async () => {
    await using tmp = await tmpdir()

    // Create a nested structure: parent/child/grandchild
    const parent = path.join(tmp.path, "org", "project")
    await fs.mkdir(parent, { recursive: true })

    await $`git init`.cwd(parent).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(parent).quiet()

    const projects = await Project.scan([tmp.path])

    expect(projects.length).toBe(1)
    expect(projects[0].worktree).toBe(parent)
  })
})

describe("Project.discover", () => {
  test("should discover favicon.png in root", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await Bun.write(path.join(tmp.path, "favicon.png"), pngData)

    await p.discover(project)

    const updated = Project.get(project.id)
    expect(updated).toBeDefined()
    expect(updated!.icon).toBeDefined()
    expect(updated!.icon?.url).toStartWith("data:")
    expect(updated!.icon?.url).toContain("base64")
    expect(updated!.icon?.color).toBeUndefined()
  })

  test("should not discover non-image files", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    await Bun.write(path.join(tmp.path, "favicon.txt"), "not an image")

    await p.discover(project)

    const updated = Project.get(project.id)
    expect(updated).toBeDefined()
    expect(updated!.icon).toBeUndefined()
  })
})

describe("Project.update", () => {
  test("should update name", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      name: "New Project Name",
    })

    expect(updated.name).toBe("New Project Name")

    const fromDb = Project.get(project.id)
    expect(fromDb?.name).toBe("New Project Name")
  })

  test("should update icon url", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      icon: { url: "https://example.com/icon.png" },
    })

    expect(updated.icon?.url).toBe("https://example.com/icon.png")

    const fromDb = Project.get(project.id)
    expect(fromDb?.icon?.url).toBe("https://example.com/icon.png")
  })

  test("should update icon color", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      icon: { color: "#ff0000" },
    })

    expect(updated.icon?.color).toBe("#ff0000")

    const fromDb = Project.get(project.id)
    expect(fromDb?.icon?.color).toBe("#ff0000")
  })

  test("should update commands", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      commands: { start: "npm run dev" },
    })

    expect(updated.commands?.start).toBe("npm run dev")

    const fromDb = Project.get(project.id)
    expect(fromDb?.commands?.start).toBe("npm run dev")
  })

  test("should throw error when project not found", async () => {
    await using tmp = await tmpdir({ git: true })

    await expect(
      Project.update({
        projectID: "nonexistent-project-id",
        name: "Should Fail",
      }),
    ).rejects.toThrow("Project not found: nonexistent-project-id")
  })

  test("should emit GlobalBus event on update", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    let eventFired = false
    let eventPayload: any = null

    GlobalBus.on("event", (data) => {
      eventFired = true
      eventPayload = data
    })

    await Project.update({
      projectID: project.id,
      name: "Updated Name",
    })

    expect(eventFired).toBe(true)
    expect(eventPayload.payload.type).toBe("project.updated")
    expect(eventPayload.payload.properties.name).toBe("Updated Name")
  })

  test("should update multiple fields at once", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      name: "Multi Update",
      icon: { url: "https://example.com/favicon.ico", color: "#00ff00" },
      commands: { start: "make start" },
    })

    expect(updated.name).toBe("Multi Update")
    expect(updated.icon?.url).toBe("https://example.com/favicon.ico")
    expect(updated.icon?.color).toBe("#00ff00")
    expect(updated.commands?.start).toBe("make start")
  })
})
