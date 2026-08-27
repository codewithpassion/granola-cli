#!/usr/bin/env bun
// granola — agent-first CLI for Granola meeting notes via MCP.
//
// Auth: mcporter OAuth (browser flow, tokens cached in ~/.mcporter/credentials.json)
// Transport: mcporter → Granola MCP (https://mcp.granola.ai/mcp)
// Output: HATEOAS JSON envelope on every command. No plain text.

import { callMcp, parseMeetingsList, ensureConfig, CONFIG_PATH, type McpError } from "./mcp.js";
import { success, fail, print, type NextAction } from "./envelope.js";

// ── Arg parsing ───────────────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function positionals(): string[] {
  return args.filter((a) => !a.startsWith("--"));
}

// ── Error helpers ─────────────────────────────────────────────

function handleMcpError(cmd: string, err: McpError): never {
  if (err.code === "AUTH_EXPIRED") {
    print(
      fail(cmd, err.message, err.code, "Re-authenticate: mcporter auth granola --config ~/.config/granola-cli/mcporter.json", [
        { command: "granola auth", description: "Re-authenticate with Granola" },
      ])
    );
  } else if (err.code === "MCP_DISABLED") {
    print(
      fail(cmd, err.message, err.code, "Enable MCP in Granola workspace settings (Settings → Integrations → MCP)", [])
    );
  } else {
    print(
      fail(cmd, err.message, err.code, "Check mcporter is installed and granola auth is completed", [
        { command: "granola auth", description: "Re-authenticate" },
        { command: "mcporter list granola --config ~/.config/granola-cli/mcporter.json", description: "Test MCP connection" },
      ])
    );
  }
  process.exit(1);
}

// ── Commands ──────────────────────────────────────────────────

const command = positionals()[0];

// ── granola (root) — self-documenting command tree ────────────

if (!command) {
  // Quick health check — can we reach MCP?
  ensureConfig();
  let healthy = false;
  try {
    const result = callMcp("list_meetings", { time_range: "this_week" });
    healthy = typeof result === "string";
  } catch {}

  print(
    success("granola", {
      description: "Granola — agent-first CLI for meeting notes",
      version: "0.1.0",
      transport: "MCP via mcporter",
      config: CONFIG_PATH,
      connected: healthy,
      commands: [
        { name: "meetings", description: "List meetings by time range", usage: "granola meetings [--range this_week|last_week|last_30_days|custom] [--start YYYY-MM-DD] [--end YYYY-MM-DD]" },
        { name: "meeting", description: "Get meeting details", usage: "granola meeting <id> [--transcript]" },
        { name: "search", description: "Natural language search over notes", usage: 'granola search "what did we decide about..."' },
        { name: "auth", description: "Authenticate with Granola (opens browser)", usage: "granola auth" },
      ],
    }, [
      { command: "granola meetings", description: "List this week's meetings" },
      { command: "granola meetings --range last_30_days", description: "List last 30 days" },
      { command: 'granola search "action items from last week"', description: "Search meeting notes" },
    ])
  );
  process.exit(0);
}

// ── granola auth — run OAuth flow ─────────────────────────────

if (command === "auth") {
  ensureConfig();
  const reset = hasFlag("reset");
  try {
    const { execFileSync } = await import("node:child_process");
    const argv = ["auth", "granola", ...(reset ? ["--reset"] : []), "--config", CONFIG_PATH, "--oauth-timeout", "180000"];
    print(
      success("granola auth", {
        message: "Starting OAuth flow — approve in your browser",
        command_run: ["mcporter", ...argv].join(" "),
        note: "If on a remote machine, tunnel port 61200: ssh -L 61200:127.0.0.1:61200 joel@panda -N",
      }, [
        { command: "granola", description: "Check connection status after auth" },
        { command: "granola meetings", description: "List meetings to verify" },
      ])
    );
    execFileSync("mcporter", argv, { stdio: "inherit", timeout: 200_000 });
  } catch (err: any) {
    print(
      fail("granola auth", err.message || "Auth failed", "AUTH_FAILED", "Try: granola auth --reset", [])
    );
    process.exit(1);
  }
  process.exit(0);
}

// ── granola meetings — list meetings ──────────────────────────

if (command === "meetings") {
  ensureConfig();
  const range = getFlag("range") || "this_week";
  const validRanges = ["this_week", "last_week", "last_30_days", "custom"];
  if (!validRanges.includes(range)) {
    print(
      fail("granola meetings", `Invalid range: ${range}`, "INVALID_RANGE", `Use one of: ${validRanges.join(", ")}`, [
        { command: "granola meetings --range last_30_days", description: "Last 30 days" },
      ])
    );
    process.exit(1);
  }

  const mcpArgs: Record<string, unknown> = { time_range: range };
  if (range === "custom") {
    const start = getFlag("start");
    const end = getFlag("end");
    if (!start || !end) {
      print(
        fail("granola meetings", "Custom range requires --start and --end", "MISSING_DATES", "granola meetings --range custom --start 2026-01-01 --end 2026-02-01", [])
      );
      process.exit(1);
    }
    mcpArgs.custom_start = start;
    mcpArgs.custom_end = end;
  }

  const result = callMcp("list_meetings", mcpArgs);
  if (typeof result !== "string") handleMcpError("granola meetings", result);

  const meetings = parseMeetingsList(result);

  const nextActions: NextAction[] = [];
  if (meetings.length > 0) {
    nextActions.push({
      command: `granola meeting ${meetings[0].id}`,
      description: `Get details: "${meetings[0].title}"`,
    });
    nextActions.push({
      command: `granola meeting ${meetings[0].id} --transcript`,
      description: `Get transcript: "${meetings[0].title}"`,
    });
  }
  nextActions.push({ command: "granola meetings --range last_30_days", description: "Expand to 30 days" });
  nextActions.push({ command: 'granola search "action items"', description: "Search across all notes" });

  print(
    success("granola meetings", {
      range,
      meetings: meetings.map((m) => ({
        id: m.id,
        title: m.title,
        date: m.date,
        participants: m.participants,
      })),
      count: meetings.length,
    }, nextActions)
  );
  process.exit(0);
}

// ── granola meeting <id> — get single meeting ─────────────────

if (command === "meeting") {
  ensureConfig();
  const meetingId = positionals()[1];
  if (!meetingId) {
    print(
      fail("granola meeting", "Missing meeting ID", "MISSING_ARG", "granola meeting <uuid>", [
        { command: "granola meetings", description: "List meetings to find an ID" },
      ])
    );
    process.exit(1);
  }

  const wantTranscript = hasFlag("transcript");

  if (wantTranscript) {
    const result = callMcp("get_meeting_transcript", { meeting_id: meetingId });
    if (typeof result !== "string") handleMcpError(`granola meeting ${meetingId} --transcript`, result);

    // Context protection: cap transcript output
    const lines = result.split("\n");
    const truncated = lines.length > 200;
    const shown = truncated ? lines.slice(0, 200).join("\n") : result;

    print(
      success(`granola meeting ${meetingId} --transcript`, {
        meeting_id: meetingId,
        transcript: shown,
        ...(truncated ? { truncated: true, total_lines: lines.length, showing: 200 } : {}),
      }, [
        { command: `granola meeting ${meetingId}`, description: "Get meeting details (no transcript)" },
        { command: "granola meetings", description: "Back to meetings list" },
      ])
    );
  } else {
    const result = callMcp("get_meetings", { meeting_ids: [meetingId] });
    if (typeof result !== "string") handleMcpError(`granola meeting ${meetingId}`, result);

    print(
      success(`granola meeting ${meetingId}`, {
        meeting_id: meetingId,
        details: result,
      }, [
        { command: `granola meeting ${meetingId} --transcript`, description: "Get full transcript" },
        { command: "granola meetings", description: "Back to meetings list" },
      ])
    );
  }
  process.exit(0);
}

// ── granola search "<query>" — natural language search ────────

if (command === "search") {
  ensureConfig();
  const query = positionals().slice(1).join(" ");
  if (!query) {
    print(
      fail("granola search", "Missing search query", "MISSING_QUERY", 'granola search "what were the action items from last week"', [
        { command: "granola meetings", description: "List meetings instead" },
      ])
    );
    process.exit(1);
  }

  const result = callMcp("query_granola_meetings", { query });
  if (typeof result !== "string") handleMcpError("granola search", result);

  print(
    success("granola search", {
      query,
      response: result,
    }, [
      { command: "granola meetings", description: "List meetings" },
      { command: `granola search "${query}" --verbose`, description: "Search again" },
    ])
  );
  process.exit(0);
}

// ── Unknown command ───────────────────────────────────────────

print(
  fail(`granola ${command}`, `Unknown command: ${command}`, "UNKNOWN_COMMAND", "Run granola with no args to see available commands", [
    { command: "granola", description: "Show command tree" },
  ])
);
process.exit(1);
