import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";

/**
 * Keywords that flag a commit as a technical/infrastructure chore rather than
 * a user-facing feature or bug fix. Matching items are excluded from the
 * changelog that users see in the release-notes popover.
 */
const CHORE_PATTERNS: RegExp[] = [
  /\bangular\s+\d+/i,           // Angular version upgrades
  /\bupgrade\b.*\bangular\b/i,
  /\bmigrat/i,                  // migrations (gen 2, firestore, etc.)
  /\bgen 2\b/i,
  /\bnode runtime\b/i,
  /\bci\/cd\b/i,
  /\bci\s+workflow\b/i,
  /\bworkflow push\b/i,
  /\bdeployment.*workflow\b/i,
  /\bauto.?deploy\b/i,
  /\bcloud functions\b/i,
  /\bsetup.*deploy/i,
  /\bhosting.*deploy/i,
  /\bfirebase hosting\b/i,
  /\bpnpm.*npm\b/i,             // package manager switches
  /\blockfile/i,
  /\btsconfig/i,
  /\bvitest\b/i,
  /\bplaywright\b/i,
  /\bzoneless\b/i,
  /\bzone\.js\b/i,
  /\boauth return\b/i,
  /\bcross.?domain redirect\b/i,
  /\bfirebase project\b/i,
  /\bsite for deploy\b/i,
  /\bprovide ?router\b/i,
  /\bsignal forms api\b/i,
  /\bsave lockfiles\b/i,
  /\borgon\b/i,
  /\beurope.?west\b/i,
];

/** Returns true if the message describes a technical chore that should not appear in the user changelog. */
function isChore(message: string): boolean {
  return CHORE_PATTERNS.some(re => re.test(message));
}

// Main repository root path
const ROOT_PATH = "/Users/mateuscarniatto/dev/PokerPlanningNeo";

// Helper for running synchronous commands and getting status/output
function runCmd(args: string[], cwd: string = process.cwd(), inheritIO = true) {
  const result = Bun.spawnSync(args, {
    cwd,
    stdout: inheritIO ? "inherit" : "pipe",
    stderr: inheritIO ? "inherit" : "pipe",
  });
  
  const stdoutStr = result.stdout ? result.stdout.toString().trim() : "";
  const stderrStr = result.stderr ? result.stderr.toString().trim() : "";
  
  return {
    success: result.success,
    exitCode: result.exitCode,
    stdout: stdoutStr,
    stderr: stderrStr,
  };
}

// Parse Command Line Arguments
const args = process.argv.slice(2);
const flags = {
  commit: args.includes("--commit") || args.includes("-c"),
  rebase: args.includes("--rebase"),
  merge: args.includes("--merge") || (!args.includes("--only") && !args.includes("--rebase")),
  test: args.includes("--test") && !args.includes("--no-test"),
  noTest: args.includes("--no-test"),
  push: args.includes("--push"),
  cleanup: args.includes("--cleanup"),
  monitor: args.includes("--monitor"),
  only: args.includes("--only"),
  approve: args.includes("--approve"),
  message: (() => {
    const idx = args.findIndex(a => a === "--message" || a === "-m");
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  })(),
};

// Help menu
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
🚀 /ship - Workspace shipping automation script for Git Worktrees

Usage:
  bun .agents/skills/ship/tools/ship.ts [worktree-path-or-name] [options]

Options:
  -c, --commit       Only/also commit local worktree changes
  -m, --message MSG  Commit message to use (forces Conventional Commits check)
  --rebase           Rebase on top of main instead of merging when syncing
  --merge            Merge main into feature branch (default)
  --test             Run tests (vitest + playwright)
  --no-test          Skip running tests
  --push             Merge feature branch to main and push
  --approve          Approve the merge/push to main (bypasses TTY check)
  --cleanup          Remove worktree, delete local/remote branches, release port
  --monitor          Monitor the CI/CD deployment on main
  --only             Only execute the specified steps (do not run full sequence)
  -h, --help         Show this help menu
`);
  process.exit(0);
}

// 1. Identify Target Worktree
let worktreePath = args.find(a => !a.startsWith("-") && a !== flags.message);
const worktreeList = runCmd(["git", "worktree", "list"], ROOT_PATH, false);
if (!worktreeList.success) {
  console.error("❌ Failed to list git worktrees.");
  process.exit(1);
}

const worktrees = worktreeList.stdout.split("\n").map(line => {
  const parts = line.split(/\s+/);
  const path = parts[0];
  const branchPart = parts.find(p => p.startsWith("[") && p.endsWith("]"));
  const branch = branchPart ? branchPart.slice(1, -1) : "";
  return { path, branch };
});

let targetWorktree = worktrees.find(wt => {
  if (worktreePath) {
    return wt.path === worktreePath || basename(wt.path) === worktreePath || wt.branch === worktreePath;
  }
  // Default to current directory if it matches a worktree path
  return process.cwd().startsWith(wt.path) && wt.path !== ROOT_PATH;
});

if (!targetWorktree) {
  // If we are not inside a worktree and didn't specify one, show list of non-root worktrees
  const activeWorktrees = worktrees.filter(wt => wt.path !== ROOT_PATH);
  if (activeWorktrees.length === 0) {
    console.error("❌ No active git worktrees found to ship.");
    process.exit(1);
  }
  
  if (activeWorktrees.length === 1) {
    targetWorktree = activeWorktrees[0];
    console.log(`ℹ️ Auto-selected the only active worktree: ${targetWorktree.path} (${targetWorktree.branch})`);
  } else {
    console.error("\n❌ Ambiguous target worktree. Please specify one of the following:");
    activeWorktrees.forEach(wt => console.error(`  - ${basename(wt.path)} (Branch: ${wt.branch})`));
    console.error("\nUsage: bun .agents/skills/ship/tools/ship.ts <worktree-name>");
    process.exit(1);
  }
}

const TARGET_CWD = targetWorktree.path;
const FEATURE_BRANCH = targetWorktree.branch;
const WORKTREE_FOLDER = basename(TARGET_CWD);

console.log(`\n📦 Shipping worktree: ${TARGET_CWD}`);
console.log(`🌿 Feature Branch:   ${FEATURE_BRANCH}`);

// Run full pipeline unless --only is specified
const runAll = !flags.only;

// Phase 1: Commit Changes
if (runAll || flags.commit) {
  console.log("\n--- [1/6] Staging and Committing Changes ---");
  
  // 1. Gather all commit messages in this feature branch since origin/main
  const commitsCmd = runCmd(["git", "log", "origin/main..HEAD", "--oneline"], TARGET_CWD, false);
  const rawCommits = commitsCmd.success ? commitsCmd.stdout.split("\n").filter(Boolean) : [];
  const commitMessages = rawCommits.map(line => line.replace(/^[a-f0-9]+\s+/, "").trim());
  
  // 2. Check for local uncommitted changes
  const statusBefore = runCmd(["git", "status", "--porcelain"], TARGET_CWD, false);
  const hasUncommitted = statusBefore.stdout.length > 0;
  
  // 3. Skip if there are absolutely no changes
  if (commitMessages.length === 0 && !hasUncommitted) {
    console.log("✅ Worktree is clean and branch is even with origin/main. Nothing to commit or release.");
  } else {
    let nextVersion = "";
    
    // Run auto-versioning and changelog updating if we have changes
    const packagePath = join(TARGET_CWD, "package.json");
    const changelogPath = join(TARGET_CWD, "src/app/changelog.ts");
    
    if (existsSync(packagePath) && existsSync(changelogPath)) {
      console.log("Running automated release versioning...");
      
      // Determine pending commit message to include in changelog parsing
      let pendingMsg = flags.message;
      if (hasUncommitted && !pendingMsg) {
        const type = FEATURE_BRANCH.startsWith("fix/") ? "fix" : "feat";
        const scope = FEATURE_BRANCH.replace(/^(feat|fix|chore|refactor)\//, "");
        pendingMsg = `${type}: ${scope.replace(/[-_]/g, " ")}`;
      }
      
      const allMessages = [...commitMessages];
      if (pendingMsg) {
        allMessages.unshift(pendingMsg);
      }
      
      let isBreaking = false;
      const features: string[] = [];
      const fixes: string[] = [];
      
      for (const msg of allMessages) {
        if (msg.includes("BREAKING CHANGE") || /^[a-z]+(\([a-z0-9-]+\))?!:/.test(msg)) {
          isBreaking = true;
        }
        
        if (/^feat(\([a-z0-9-]+\))?:/.test(msg)) {
          const cleanMsg = msg.replace(/^feat(\([a-z0-9-]+\))?:\s*/, "");
          const formatted = cleanMsg.charAt(0).toUpperCase() + cleanMsg.slice(1);
          // Skip technical/infrastructure chores — they are not user-facing
          if (!isChore(formatted)) {
            features.push(formatted);
          }
        } else if (/^fix(\([a-z0-9-]+\))?:/.test(msg)) {
          const cleanMsg = msg.replace(/^fix(\([a-z0-9-]+\))?:\s*/, "");
          const formatted = cleanMsg.charAt(0).toUpperCase() + cleanMsg.slice(1);
          if (!isChore(formatted)) {
            fixes.push(formatted);
          }
        }
      }
      
      // If we don't have standard feat/fix commits, use the first commit/pending message
      if (features.length === 0 && fixes.length === 0 && allMessages.length > 0) {
        const msg = allMessages[0];
        const isFix = FEATURE_BRANCH.startsWith("fix/");
        if (isFix) {
          fixes.push(msg);
        } else {
          features.push(msg);
        }
      }
      
      const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      nextVersion = `${yyyy}.${mm}.${dd}`;
      
      pkg.version = nextVersion;
      writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
      console.log(`📈 Set daily package version to: ${nextVersion}`);
      
      // Update changelog.ts
      let rawContent = readFileSync(changelogPath, "utf-8");
      const declStr = "export const CHANGELOG: ChangelogEntry[] =";
      const declIndex = rawContent.indexOf(declStr);
      const arrayStart = rawContent.indexOf("[", declIndex !== -1 ? declIndex + declStr.length : 0);
      const arrayEnd = rawContent.lastIndexOf("]") + 1;
      
      if (arrayStart !== -1 && arrayEnd !== -1) {
        const jsonText = rawContent.slice(arrayStart, arrayEnd);
        const changelog = JSON.parse(jsonText);
        
        const todayIndex = changelog.findIndex((entry: any) => entry.version === nextVersion);
        
        if (todayIndex !== -1) {
          // Append to today's entry
          const existing = changelog[todayIndex];
          for (const feat of features) {
            // Deduplicate exact matches and case-insensitive/prefix matches
            const exists = existing.features.some((f: string) => f.toLowerCase().trim() === feat.toLowerCase().trim());
            if (!exists) {
              existing.features.push(feat);
            }
          }
          if (!existing.fixes) {
            existing.fixes = [];
          }
          for (const fix of fixes) {
            const exists = existing.fixes.some((f: string) => f.toLowerCase().trim() === fix.toLowerCase().trim());
            if (!exists) {
              existing.fixes.push(fix);
            }
          }
          console.log(`ℹ️ Appended features/fixes to today's daily release entry (v${nextVersion}) in src/app/changelog.ts`);
        } else {
          // Prepend a new daily release entry
          const newEntry = {
            version: nextVersion,
            date: `${yyyy}-${mm}-${dd}`,
            features: features,
            fixes: fixes
          };
          changelog.unshift(newEntry);
          console.log(`📝 Created new daily release entry (v${nextVersion}) in src/app/changelog.ts`);
        }
        
        const updatedContent = `export interface ChangelogEntry {
  version: string;
  date: string;
  features: string[];
  fixes?: string[];
}

export const CHANGELOG: ChangelogEntry[] = ${JSON.stringify(changelog, null, 2)};
`;
        writeFileSync(changelogPath, updatedContent, "utf-8");
      } else {
        console.warn("⚠️ Could not match CHANGELOG array pattern in src/app/changelog.ts");
      }
    }
    
    // Now perform the git commit with the auto-bumped changes included
    const statusAfter = runCmd(["git", "status", "--porcelain"], TARGET_CWD, false);
    if (statusAfter.stdout.length > 0) {
      console.log("Staging and committing release changes...");
      
      let commitMsg = flags.message;
      if (!commitMsg) {
        if (hasUncommitted) {
          const type = FEATURE_BRANCH.startsWith("fix/") ? "fix" : "feat";
          const scope = FEATURE_BRANCH.replace(/^(feat|fix|chore|refactor)\//, "");
          commitMsg = `${type}: ${scope.replace(/[-_]/g, " ")}`;
        } else {
          commitMsg = `chore(release): bump version to v${nextVersion} and update changelog`;
        }
      }
      
      console.log(`Commit message: "${commitMsg}"`);
      runCmd(["git", "add", "."], TARGET_CWD);
      const commit = runCmd(["git", "commit", "-m", commitMsg], TARGET_CWD);
      if (!commit.success) {
        console.error("❌ Failed to commit changes.");
        process.exit(1);
      }
    } else {
      console.log("✅ Worktree is clean. Nothing to commit.");
    }
  }
}

// Phase 2: Sync with Main
if (runAll || flags.rebase || flags.merge) {
  console.log("\n--- [2/6] Syncing Feature Branch with Main ---");
  console.log("Fetching latest changes from origin...");
  runCmd(["git", "fetch", "origin", "main"], TARGET_CWD);
  
  if (flags.rebase) {
    console.log("Rebasing feature branch on origin/main...");
    const rebase = runCmd(["git", "rebase", "origin/main"], TARGET_CWD);
    if (!rebase.success) {
      console.error("❌ Rebase failed. Please resolve conflicts manually inside the worktree, then run ship again.");
      process.exit(1);
    }
  } else {
    console.log("Merging origin/main into feature branch...");
    const merge = runCmd(["git", "merge", "origin/main", "--no-edit"], TARGET_CWD);
    if (!merge.success) {
      console.error("❌ Merge failed. Please resolve conflicts manually inside the worktree, then run ship again.");
      process.exit(1);
    }
  }
  console.log("✅ Synced successfully.");
}

// Phase 3: Run Tests
if ((runAll && !flags.noTest) || flags.test) {
  console.log("\n--- [3/6] Running Tests ---");
  console.log("Running Vitest unit tests...");
  const vitest = runCmd(["pnpm", "test"], TARGET_CWD);
  if (!vitest.success) {
    console.error("❌ Unit tests failed. Aborting ship.");
    process.exit(1);
  }
  
  console.log("Running Playwright E2E tests...");
  const playwright = runCmd(["pnpm", "exec", "playwright", "test"], TARGET_CWD);
  if (!playwright.success) {
    console.error("❌ E2E tests failed. Aborting ship.");
    process.exit(1);
  }
  console.log("✅ All tests passed successfully!");
}

// Phase 4: Merge to Main and Push
let mergeTimestamp = Date.now();
if (runAll || flags.push) {
  console.log("\n--- [4/6] Merging and Pushing to Main ---");
  
  if (!flags.approve) {
    const isInteractive = process.stdin.isTTY || process.stdout.isTTY;
    if (isInteractive) {
      const answer = prompt("⚠️ CRITICAL: You are about to merge and push to production main branch. Do you want to proceed? (yes/no):");
      if (answer?.trim().toLowerCase() !== "yes") {
        console.error("❌ Aborted: Push to main cancelled by user.");
        process.exit(1);
      }
    } else {
      console.error("❌ Error: Push to main requires explicit approval. Run in an interactive terminal or pass the --approve flag.");
      process.exit(1);
    }
  }
  
  // Check if main root directory is dirty
  const rootStatus = runCmd(["git", "status", "--porcelain"], ROOT_PATH, false);
  const isRootDirty = rootStatus.stdout.length > 0;
  
  if (isRootDirty) {
    console.log("Root repository is dirty. Stashing changes temporarily...");
    runCmd(["git", "stash"], ROOT_PATH);
  }
  
  console.log("Checking out main branch in root repo...");
  runCmd(["git", "checkout", "main"], ROOT_PATH);
  runCmd(["git", "pull", "origin", "main"], ROOT_PATH);
  
  console.log(`Merging ${FEATURE_BRANCH} into main...`);
  const mergeMain = runCmd(["git", "merge", FEATURE_BRANCH, "--no-edit"], ROOT_PATH);
  if (!mergeMain.success) {
    console.error("❌ Failed to merge feature branch into main.");
    if (isRootDirty) {
      runCmd(["git", "stash", "pop"], ROOT_PATH);
    }
    process.exit(1);
  }
  
  console.log("Pushing main to origin...");
  const pushMain = runCmd(["git", "push", "origin", "main"], ROOT_PATH);
  if (!pushMain.success) {
    console.error("❌ Failed to push main to origin.");
    if (isRootDirty) {
      runCmd(["git", "stash", "pop"], ROOT_PATH);
    }
    process.exit(1);
  }
  
  if (isRootDirty) {
    console.log("Restoring stashed changes in root repo...");
    runCmd(["git", "stash", "pop"], ROOT_PATH);
  }
  
  mergeTimestamp = Date.now();
  console.log("✅ Successfully merged and pushed to main.");
}

// Phase 5: Cleanup Worktree, Branch, and Port
if (runAll || flags.cleanup) {
  console.log("\n--- [5/6] Cleaning up Worktree, Branch, and Port ---");
  
  // 1. Release active port in .agent/active_ports.json
  const portsPath = join(ROOT_PATH, ".agent/active_ports.json");
  if (existsSync(portsPath)) {
    try {
      const portsData = JSON.parse(readFileSync(portsPath, "utf-8"));
      let updated = false;
      
      const folderBase = WORKTREE_FOLDER.toLowerCase();
      const matchedKey = Object.entries(portsData).find(([p, desc]) => {
        const d = String(desc).toLowerCase();
        const f = folderBase;
        // Match descriptions matching folderBase
        return f.includes(d) || d.includes(f) || f.replace("wt-", "").includes(d);
      });
      
      if (matchedKey) {
        const portNum = matchedKey[0];
        console.log(`Releasing port ${portNum} (claimed for '${matchedKey[1]}') from active_ports.json...`);
        delete portsData[portNum];
        writeFileSync(portsPath, JSON.stringify(portsData), "utf-8");
        updated = true;
      }
      
      if (!updated) {
        console.log("No claimed ports found for this worktree in active_ports.json.");
      }
    } catch (e) {
      console.warn("Warning: Could not update .agent/active_ports.json", e);
    }
  }
  
  // 2. Remove Git Worktree
  console.log(`Removing git worktree: ${TARGET_CWD}...`);
  runCmd(["git", "worktree", "remove", "--force", TARGET_CWD], ROOT_PATH);
  
  // 3. Delete local branch
  console.log(`Deleting local branch: ${FEATURE_BRANCH}...`);
  runCmd(["git", "branch", "-D", FEATURE_BRANCH], ROOT_PATH);
  
  // 4. Delete remote branch
  console.log(`Deleting remote branch: origin/${FEATURE_BRANCH}...`);
  runCmd(["git", "push", "origin", "--delete", FEATURE_BRANCH], ROOT_PATH);
  
  console.log("✅ Cleanup complete.");
}

// Phase 6: Monitor CI
if (runAll || flags.monitor) {
  console.log("\n--- [6/6] Monitoring CI/CD Deployment ---");
  console.log("Waiting for GitHub Actions CI run to trigger...");
  
  let runId = "";
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    // Wait 3 seconds
    Bun.sleepSync(3000);
    attempts++;
    
    // Fetch latest runs for 'main'
    const runsList = runCmd(
      ["gh", "run", "list", "--branch", "main", "--limit", "3", "--json", "databaseId,status,conclusion,url,createdAt"],
      ROOT_PATH,
      false
    );
    
    if (runsList.success) {
      try {
        const runs = JSON.parse(runsList.stdout);
        // Find the run that is triggered after our mergeTimestamp
        // GitHub API timestamps are in ISO format
        const matchedRun = runs.find((r: any) => {
          const runTime = new Date(r.createdAt).getTime();
          // Allow small clock skew (e.g. up to 1 minute before mergeTimestamp)
          return runTime > (mergeTimestamp - 60000);
        });
        
        if (matchedRun) {
          runId = String(matchedRun.databaseId);
          console.log(`Found CI Run ID: ${runId}`);
          console.log(`Workflow URL:   ${matchedRun.url}`);
          break;
        }
      } catch (e) {
        // Parse error
      }
    }
  }
  
  if (!runId) {
    console.warn("⚠️ Could not detect new CI run automatically. Watching latest run on main...");
  }
  
  console.log("Watching run progress...");
  const watchArgs = ["gh", "run", "watch"];
  if (runId) watchArgs.push(runId);
  watchArgs.push("--compact", "--exit-status");
  
  const watchResult = runCmd(watchArgs, ROOT_PATH);
  if (watchResult.success) {
    console.log("\n🎉 CI/CD Deployment Completed Successfully!");
  } else {
    console.error("\n❌ CI/CD Deployment Failed or watch interrupted.");
    process.exit(1);
  }
}
