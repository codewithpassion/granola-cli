// Granola MCP client — wraps mcporter calls.
//
// Requires mcporter installed + OAuth completed:
//   mcporter auth granola --config <config>

import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";

const CONFIG_PATH = path.join(os.homedir(), ".config", "granola-cli", "mcporter.json");

export interface McpError {
  error: true;
  message: string;
  code: string;
}

function isMcpError(result: unknown): result is McpError {
  return typeof result === "object" && result !== null && "error" in result;
}

/** Call a Granola MCP tool via mcporter.
 *
 * Arguments are sent as a JSON payload over --args and the binary is invoked
 * directly, so no caller-supplied value is ever parsed by a shell or by
 * mcporter's function-call syntax. */
export function callMcp(tool: string, args: Record<string, unknown> = {}): string | McpError {
  try {
    const output = execFileSync(
      "mcporter",
      ["call", "--config", CONFIG_PATH, `granola.${tool}`, "--args", JSON.stringify(args)],
      { encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] }
    );
    return output.trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";

    if (stderr.includes("MCP is disabled")) {
      return { error: true, message: "MCP is disabled for your workspace", code: "MCP_DISABLED" };
    }
    if (stderr.includes("OAuth") || stderr.includes("authorization")) {
      return { error: true, message: "OAuth session expired or not completed", code: "AUTH_EXPIRED" };
    }

    // mcporter sometimes writes the result to stdout even with non-zero exit
    if (stdout.trim()) return stdout.trim();

    return {
      error: true,
      message: stderr.trim() || err.message || "mcporter call failed",
      code: "MCP_CALL_FAILED",
    };
  }
}

/** Parse XML-ish meeting list from MCP response */
export interface MeetingSummary {
  id: string;
  title: string;
  date: string;
  participants: string[];
}

export function parseMeetingsList(raw: string): MeetingSummary[] {
  const meetings: MeetingSummary[] = [];
  const meetingRegex = /<meeting\s+id="([^"]+)"\s+title="([^"]+)"\s+date="([^"]+)">/g;
  const participantRegex = /^\s*(.+?)\s*<([^>]+)>\s*$/gm;

  let match;
  while ((match = meetingRegex.exec(raw)) !== null) {
    const [, id, title, date] = match;
    // Find participants between this meeting tag and the next </meeting>
    const startIdx = match.index + match[0].length;
    const endIdx = raw.indexOf("</meeting>", startIdx);
    const block = raw.slice(startIdx, endIdx);

    const participants: string[] = [];
    let pMatch;
    while ((pMatch = participantRegex.exec(block)) !== null) {
      const name = pMatch[1].replace(/\(note creator\)/, "").trim();
      if (name) participants.push(name);
    }
    participantRegex.lastIndex = 0;

    meetings.push({ id, title, date, participants });
  }

  return meetings;
}

export function ensureConfig(): McpError | null {
  try {
    const fs = require("node:fs");
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(
        CONFIG_PATH,
        JSON.stringify(
          {
            mcpServers: {
              granola: {
                url: "https://mcp.granola.ai/mcp",
                auth: "oauth",
                oauthRedirectUrl: "http://127.0.0.1:61200/callback",
              },
            },
          },
          null,
          2
        )
      );
    }
    return null;
  } catch (err: any) {
    return { error: true, message: `Failed to write config: ${err.message}`, code: "CONFIG_ERROR" };
  }
}

export { CONFIG_PATH };
