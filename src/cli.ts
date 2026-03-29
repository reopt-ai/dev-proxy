export const KNOWN_COMMANDS = [
  "init",
  "status",
  "doctor",
  "config",
  "project",
  "worktree",
];

const args = process.argv.slice(2);
const command = args[0];

// Global flags — take priority over subcommands
if (args.includes("--help") || args.includes("-h")) {
  await import("./commands/help.js");
} else if (args.includes("--version") || args.includes("-v")) {
  await import("./commands/version.js");
} else {
  switch (command) {
    case undefined:
      await import("./index.js");
      break;
    case "init":
      await import("./commands/init.js");
      break;
    case "status":
      await import("./commands/status.js");
      break;
    case "doctor":
      await import("./commands/doctor.js");
      break;
    case "config":
      await import("./commands/config.js");
      break;
    case "project":
      await import("./commands/project.js");
      break;
    case "worktree":
      await import("./commands/worktree.js");
      break;
    default: {
      // Unknown command — suggest closest match
      const suggestion = closest(command, KNOWN_COMMANDS);
      console.error(`\n  \x1b[31m\u2717\x1b[0m Unknown command: ${command}`);
      if (suggestion) {
        console.error(`\n  Did you mean \x1b[36m${suggestion}\x1b[0m?`);
      }
      console.error(`\n  Run \x1b[2mdev-proxy --help\x1b[0m for available commands.\n`);
      process.exitCode = 1;
    }
  }
}

export function closest(input: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(input, c);
    if (d < bestDist && d <= 3) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    const row = dp[i] as number[];
    const prevRow = dp[i - 1] as number[];
    for (let j = 1; j <= n; j++) {
      row[j] =
        a[i - 1] === b[j - 1]
          ? (prevRow[j - 1] as number)
          : 1 +
            Math.min(
              prevRow[j] as number,
              row[j - 1] as number,
              prevRow[j - 1] as number,
            );
    }
  }
  return (dp[m] as number[])[n] as number;
}
