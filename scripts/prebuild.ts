// `mygo build` renames build/<platform> away before recompiling; Windows
// refuses that while an executable inside it is still mapped. Kill any process
// running out of build/ first.
import { closeSync, openSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const outDir = resolve(import.meta.dir, "..", "build");

if (process.platform === "win32") {
  const exes = findExecutables(outDir);
  if (exes.some(isLocked)) {
    killProcessesUnder(outDir);
    const stuck = findExecutables(outDir).filter(isLocked);
    if (stuck.length > 0) {
      console.error(`prebuild: still locked: ${stuck.join(", ")}`);
      process.exit(1);
    }
  }
}

function findExecutables(dir: string): string[] {
  const found: string[] = [];
  for (const platform of readdirOrEmpty(dir)) {
    const sub = join(dir, platform);
    if (!statSync(sub).isDirectory()) continue;
    for (const file of readdirOrEmpty(sub)) {
      if (!file.toLowerCase().endsWith(".exe")) continue;
      const path = join(sub, file);
      if (statSync(path).isFile()) found.push(path);
    }
  }
  return found;
}

function readdirOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// A write-capable open fails with a sharing violation exactly while the image runs.
function isLocked(path: string): boolean {
  try {
    closeSync(openSync(path, "r+"));
    return false;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EBUSY" || code === "EPERM" || code === "EACCES";
  }
}

function killProcessesUnder(dir: string): void {
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$root=$env:GITJET_BUILD_ROOT",
    "Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($root, 'OrdinalIgnoreCase') } | ForEach-Object {",
    '  Write-Output "prebuild: stopping $($_.Id) $($_.Path)"',
    "  Stop-Process -Id $_.Id -Force",
    "}",
  ].join("\n");
  const result = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, GITJET_BUILD_ROOT: dir },
    stdout: "pipe",
    stderr: "pipe",
  });
  process.stdout.write(result.stdout);
}
