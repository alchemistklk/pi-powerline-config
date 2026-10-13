import { readPowerlineStyle, styleIcon, DEFAULT_STYLE, type PowerlineStyle } from './style.ts';
/**
 * Custom Footer Extension
 *
 * Mirrors the built-in footer layout: pwd line, stats line, extension statuses line.
 *
 * Token stats and context usage come from ctx.sessionManager/ctx.model/ctx.getContextUsage().
 * Git branch, provider count, extension statuses come from footerData.
 * Thinking level comes from pi.getThinkingLevel() + pi.on(thinking_level_select).
 * The pi-mcp-adapter "mcp" status (e.g. "MCP 3/3") is fused into the right side of
 * the stats line when footer-mcp is on, instead of taking its own line.
 *
 * Controlled by .pi/settings.json → footer (boolean, default true)
 * and footer-mcp (boolean, default true).
 * Toggle at runtime via /powerline footer:on / footer:off / footer-mcp:on / footer-mcp:off.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { hasNerdFonts, hexFg, withIcon } from './utils.ts';
import { readPowerlineSettings } from './settings.ts';

// ═══════════════════════════════════════════════════════════════════════════
// auto-compact detection (nested under compaction.enabled, not powerline)
// ═══════════════════════════════════════════════════════════════════════════
function readAutoCompactEnabled(cwd: string): boolean {
  const settingsPath = join(cwd, '.pi', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const content = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content || '{}');
      if (
        settings.compaction &&
        typeof settings.compaction === 'object' &&
        'enabled' in (settings.compaction as Record<string, unknown>)
      ) {
        return !!(settings.compaction as Record<string, unknown>).enabled;
      }
    } catch {
      // ignore parse errors
    }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// token formatting (mirrors built-in footer)
// ═══════════════════════════════════════════════════════════════════════════

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

// ═══════════════════════════════════════════════════════════════════════════
// think level display
// ═══════════════════════════════════════════════════════════════════════════

const ICON_THINK = '';
const ICON_GIT = '';

const THINK_LABELS: Record<string, string> = {
  minimal: 'min',
  low: 'low',
  medium: 'med',
  high: 'high',
  xhigh: 'xhi',
  max: 'max',
};

const THINK_COLORS: Record<string, string> = {
  minimal: 'thinkingMinimal',
  low: 'thinkingLow',
  medium: 'thinkingMedium',
  high: 'thinkingHigh',
  xhigh: 'thinkingXhigh',
  max: 'thinkingMax',
};

export function getThinkingLevelDisplay(level: string): { label: string; color: string } {
  return {
    label: THINK_LABELS[level] ?? level,
    color: THINK_COLORS[level] ?? 'thinkingOff',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// usage helpers (for fusing live streaming data with persisted entries)
// ═══════════════════════════════════════════════════════════════════════════

type SessionAssistantUsage = AssistantMessage['usage'];

function getUsageTokenTotal(usage: SessionAssistantUsage): number {
  return (
    ('totalTokens' in usage && typeof usage.totalTokens === 'number' ? usage.totalTokens : 0) ||
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  );
}

function getCacheHitRate(usage: SessionAssistantUsage): number | undefined {
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  return promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
}

function isSessionAssistantMessage(value: unknown): value is AssistantMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'role' in value &&
    (value as any).role === 'assistant' &&
    'usage' in value &&
    typeof (value as any).usage?.input === 'number' &&
    typeof (value as any).usage?.output === 'number'
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// live state (updated by events)
// ═══════════════════════════════════════════════════════════════════════════

let liveThinkLevel = 'off';
let liveTui: any = null;
let isStreaming = false;
let liveAssistantUsage: SessionAssistantUsage | null = null;
let autoCompactEnabled = true;
let showFooterMcp = true;

// ═══════════════════════════════════════════════════════════════════════════
// footer renderer
// ═══════════════════════════════════════════════════════════════════════════

/** Sanitize text for single-line status display. */
function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

/** One right-aligned segment on the stats line (MCP status or think level). */
export interface RightSegment {
  kind: 'mcp' | 'think';
  text: string;
  width: number;
}

/** Visible width of consecutive right-aligned segments (single-space separated). */
function segmentsWidth(segments: RightSegment[]): number {
  return segments.reduce((sum, s) => sum + s.width, 0) + Math.max(0, segments.length - 1);
}

function segmentsText(segments: RightSegment[]): string {
  return segments.map((s) => s.text).join(' ');
}

/**
 * Right-side content that fits into `budget` visible columns.
 * Candidates degrade from the full set to dropping MCP, then to nothing, so the
 * think level outlives the MCP status when space runs out.
 */
export function pickRightSide(
  segments: RightSegment[],
  budget: number,
): { width: number; text: string } {
  const candidates: RightSegment[][] = [segments];
  if (segments.some((s) => s.kind === 'mcp')) {
    candidates.push(segments.filter((s) => s.kind !== 'mcp'));
  }
  candidates.push([]);

  for (const candidate of candidates) {
    const width = segmentsWidth(candidate);
    if (width <= budget) return { width, text: segmentsText(candidate) };
  }
  return { width: 0, text: '' };
}

export function isSubscriptionAuth(ctx: ExtensionContext): boolean {
  const model = ctx.model;
  if (!model) return false;
  if (model.provider === 'kimi-coding') return true;

  const provider = ctx.modelRegistry.getProvider(model.provider);
  return ctx.modelRegistry.isUsingOAuth(model) && provider?.auth.oauth?.isSubscription === true;
}

// ═══════════════════════════════════════════════════════════════════════════
// built-in MCP status
//
// pi-mcp-adapter published its own `mcp` extension status, which the renderer
// fuses into the stats line. The core MCP extension writes no footer status, so
// without the adapter that segment stays empty. Count the `mcp__*` namespaces
// among the registered tools against the enabled entries of `mcp.json`.
// ═══════════════════════════════════════════════════════════════════════════

/** Server names may contain `-` or `.`; MCP tool namespaces replace those with `_`. */
export function mcpNamespace(server: string): string {
  return `mcp__${server.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

/** `mcpServers` entries of one mcp.json as [name, enabled] pairs. Empty when unreadable. */
function readMcpServers(path: string): Array<[string, boolean]> {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      mcpServers?: Record<string, { enabled?: boolean } | undefined>;
    };
    const servers = parsed?.mcpServers;
    if (!servers || typeof servers !== 'object') return [];
    return Object.entries(servers).map(([name, config]) => [name, config?.enabled !== false]);
  } catch {
    return [];
  }
}

/** Enabled servers of the session: the user file first, the project file overriding it. */
export function enabledMcpServers(cwd: string): string[] {
  const effective = new Map<string, boolean>();
  const paths = [
    join(process.env.HOME ?? homedir(), '.pi', 'agent', 'mcp.json'),
    join(cwd, '.pi', 'mcp.json'),
  ];
  for (const path of paths) {
    for (const [name, enabled] of readMcpServers(path)) effective.set(name, enabled);
  }
  return [...effective].filter(([, enabled]) => enabled).map(([name]) => name);
}

/**
 * `MCP <connected>/<configured>`, or undefined when the session configures no server or none of
 * them registered tools yet. The latter also covers a pi without `ToolInfo.namespace`.
 *
 * "connected" means the server registered its tools, which is all the core extension exposes;
 * it does not prove the backing service (Blender, ComfyUI, a browser) answers.
 */
export function countMcpStatus(
  tools: ReadonlyArray<{ namespace?: { name?: string } }>,
  servers: readonly string[],
): string | undefined {
  if (servers.length === 0) return undefined;
  const namespaces = new Set(
    tools.map((tool) => tool.namespace?.name).filter((name): name is string => !!name),
  );
  const up = servers.filter((server) => namespaces.has(mcpNamespace(server))).length;
  // Servers connect in the background; stay silent until at least one has tools.
  if (up === 0) return undefined;
  return `MCP ${up}/${servers.length}`;
}

/** How often, and for how long, to watch the tool list while MCP servers connect. */
export const MCP_REPAINT_MS = 1000;
export const MCP_REPAINT_TICKS = 30;

/**
 * Repaint the TUI whenever the registered tool count changes, and return a stop function.
 *
 * MCP servers connect in the background and nothing else repaints the footer when they finish, so
 * the segment would otherwise only appear after the next keystroke. Watching stops by itself.
 */
export function watchToolCount(
  pi: Pick<ExtensionAPI, 'getAllTools'>,
  tui: { requestRender(): void },
  intervalMs: number = MCP_REPAINT_MS,
  ticks: number = MCP_REPAINT_TICKS,
): () => void {
  let count = pi.getAllTools().length;
  let elapsed = 0;
  const timer = setInterval(() => {
    const next = pi.getAllTools().length;
    if (next !== count) {
      count = next;
      tui.requestRender();
    }
    if (++elapsed >= ticks) clearInterval(timer);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Both forge providers share the footer palette; OSC 8 links remain intact. */
export function recolorPullRequest(text: string, style: PowerlineStyle = DEFAULT_STYLE): string {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
  const label = plain.match(/^PR (.*?)(?= draft| CI | no checks|: merged|: closed| stale|$)/);
  if (!label || !/#\d+/.test(label[1])) return style.show.prDetails ? hexFg(style.colors.status, plain) : '';
  if (!style.show.prDetails) {
    const color = /\bstale\b/.test(plain.slice(label[0].length)) ? style.colors.prStale : style.colors.pr;
    return hexFg(color, styleIcon(style.icons.pr, label[1]));
  }
  let tail = plain.slice(label[0].length);
  tail = tail.replace(/draft|CI passing|CI failing|CI pending|CI unknown|no checks|merged|closed|stale/g, token => {
    const color = token === 'draft' ? style.colors.prDraft : token === 'CI passing' ? style.colors.ciPass
      : token === 'CI failing' ? style.colors.ciFail : token === 'CI pending' ? style.colors.ciPending
      : token === 'merged' ? style.colors.prMerged : token === 'stale' ? style.colors.prStale : style.colors.ciUnknown;
    return hexFg(color, token);
  });
  return hexFg(style.colors.pr, styleIcon(style.icons.pr, 'PR ' + label[1])) + tail;
}

function neutralStatus(text: string, color = '#a7adb8'): string {
  return hexFg(color, text.replace(/\x1b\[[0-9;]*m/g, '')) + '\x1b[39m';
}

/** Wrap whole information groups; keep session names visible without displacing context. */
export function layoutCompactFooter(groups: string[], session: string, width: number, separator = ' │ '): string[] {
  width = Math.max(1, Math.floor(width));
  const lines: string[] = [];
  let line = '';
  for (const group of groups.filter(Boolean)) {
    const text = truncateToWidth(group, width, '…');
    if (line && visibleWidth(line + separator + text) > width) {
      lines.push(line);
      line = text;
    } else line = line ? line + separator + text : text;
  }
  if (line) lines.push(line);
  if (session) {
    const title = truncateToWidth(session, width, '…');
    const last = lines.length - 1;
    const gap = last >= 0 ? width - visibleWidth(lines[last]) - visibleWidth(title) : -1;
    if (gap >= 2) lines[last] += ' '.repeat(gap) + title;
    else lines.push(' '.repeat(Math.max(0, width - visibleWidth(title))) + title);
  }
  return lines;
}

/** Build the footer factory; exported for tests. */
export function createFooterRenderer(ctx: ExtensionContext, pi: ExtensionAPI) {
  const style = readPowerlineStyle(ctx.cwd);
  // Servers connect in the background, and render() runs several times a second.
  let builtinMcp: { at: number; value: string | undefined } | null = null;

  const builtinMcpStatus = (): string | undefined => {
    const now = Date.now();
    if (builtinMcp && now - builtinMcp.at < 2000) return builtinMcp.value;
    let value: string | undefined;
    try {
      value = countMcpStatus(pi.getAllTools(), enabledMcpServers(ctx.cwd));
    } catch {
      value = undefined;
    }
    builtinMcp = { at: now, value };
    return value;
  };

  return (tui: any, theme: any, footerData: any) => {
    liveTui = tui;
    const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
    const unwatchTools = watchToolCount(pi, tui);

    return {
      dispose() {
        liveTui = null;
        unwatchTools();
        unsubBranch();
      },
      invalidate() {},
      render(width: number): string[] {
        // ── cumulative token stats from persisted entries + live streaming ──
        let totalInput = 0,
          totalOutput = 0,
          totalCacheRead = 0,
          totalCacheWrite = 0,
          totalCost = 0;
        let lastPersistedAssistant: AssistantMessage | undefined;
        for (const e of ctx.sessionManager.getEntries()) {
          if (e.type === 'message' && e.message.role === 'assistant') {
            const m = e.message as AssistantMessage;
            if (m.stopReason === 'error' || m.stopReason === 'aborted') continue;
            totalInput += m.usage.input;
            totalOutput += m.usage.output;
            totalCacheRead += m.usage.cacheRead;
            totalCacheWrite += m.usage.cacheWrite;
            totalCost += m.usage.cost.total;
            if (getUsageTokenTotal(m.usage) > 0) {
              lastPersistedAssistant = m;
            }
          }
        }

        // fuse live streaming usage (not yet persisted) on top of persisted totals
        const latestUsage = isStreaming
          ? (liveAssistantUsage ?? lastPersistedAssistant?.usage)
          : lastPersistedAssistant?.usage;
        if (isStreaming && liveAssistantUsage) {
          totalInput += liveAssistantUsage.input;
          totalOutput += liveAssistantUsage.output;
          totalCacheRead += liveAssistantUsage.cacheRead;
          totalCacheWrite += liveAssistantUsage.cacheWrite;
          totalCost += liveAssistantUsage.cost.total;
        }

        // ── context usage ──
        // During streaming, ctx.getContextUsage() may be stale; estimate from usage.
        const coreContextUsage = isStreaming && liveAssistantUsage ? null : ctx.getContextUsage();
        const contextTokens =
          coreContextUsage?.tokens ?? (latestUsage ? getUsageTokenTotal(latestUsage) : null);
        const contextWindow = coreContextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
        const contextPercent =
          contextTokens !== null ? ((contextTokens / contextWindow) * 100).toFixed(1) : '?';

        // Local compact footer: preserve operational stats, omit cost/LSP/cache volumes.
        const branch = footerData.getGitBranch();
        const groups: string[] = [];
        if (style.show.folder) groups.push(hexFg(style.colors.folder, styleIcon(style.icons.folder, basename(ctx.cwd) || ctx.cwd)));
        if (branch && style.show.branch) groups.push(hexFg(style.colors.branch, styleIcon(style.icons.branch, sanitizeStatusText(branch))));
        const percent = contextTokens !== null && contextWindow > 0
          ? (contextTokens / contextWindow) * 100 : null;
        const context = styleIcon(style.icons.context, (percent === null ? `?/${formatTokens(contextWindow)}`
          : `${percent.toFixed(1)}%/${formatTokens(contextWindow)}`));
        if (style.show.context) groups.push(percent !== null && percent >= 90 ? theme.fg('error', context)
          : percent !== null && percent >= 70 ? theme.fg('warning', context)
          : hexFg(style.colors.context, context));
        const tokens = [`↑${formatTokens(totalInput)}`, `↓${formatTokens(totalOutput)}`];
        const hit = latestUsage ? getCacheHitRate(latestUsage) : undefined;
        if (hit !== undefined) tokens.push(styleIcon(style.icons.cache, `${hit.toFixed(1)}%`));
        if (style.show.tokens) groups.push(hexFg(style.colors.tokens, tokens.join(' ')));
        const statuses = footerData.getExtensionStatuses() as Map<string, string>;
        for (const [key, text] of [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          if (key === 'pull-request' && !style.show.pr) continue;
          if (style.hiddenStatuses.some(hidden => key.toLowerCase().includes(hidden.toLowerCase()) || text.trim().toLowerCase().startsWith(hidden.toLowerCase() + ' '))) continue;
          const cleaned = sanitizeStatusText(text);
          if (cleaned) groups.push(key === 'pull-request' ? recolorPullRequest(cleaned, style)
            : (key === 'background-tasks' || key === 'mcp') ? neutralStatus(cleaned, style.colors.status) : cleaned);
        }
        if (showFooterMcp && !statuses.get('mcp')) {
          const mcp = builtinMcpStatus();
          if (mcp) groups.push(hexFg(style.colors.status, styleIcon(style.icons.mcp, mcp)));
        }
        const name = sanitizeStatusText(pi.getSessionName() || '');
        const session = name && style.show.session && style.sessionPlacement === 'footer' ? hexFg(style.colors.session, styleIcon(style.icons.session, name)) : '';
        return layoutCompactFooter(groups, session, width, theme.fg('dim', style.separator));
      },
    };
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// module registration
// ═══════════════════════════════════════════════════════════════════════════

export function registerFooter(pi: ExtensionAPI) {
  let enabled = false;

  function enable(ctx: ExtensionContext) {
    enabled = true;
    liveThinkLevel = pi.getThinkingLevel();
    showFooterMcp = readPowerlineSettings(ctx.cwd)['footer-mcp'];
    ctx.ui.setFooter(createFooterRenderer(ctx, pi));
  }

  function disable(ctx: ExtensionContext) {
    enabled = false;
    liveTui = null;
    ctx.ui.setFooter(undefined);
  }

  // enable on session start if powerline master switch + footer setting are both on
  pi.on('session_start', (_event, ctx) => {
    autoCompactEnabled = readAutoCompactEnabled(ctx.cwd);
    const s = readPowerlineSettings(ctx.cwd);
    if (s.powerline && s.footer) {
      enable(ctx);
    }
  });

  // track thinking level changes for footer display
  pi.on('thinking_level_select', (event) => {
    if (!enabled) return;
    liveThinkLevel = event.level;
    liveTui?.requestRender();
  });

  // model switch may affect reasoning support / provider count
  pi.on('model_select', (_event, ctx) => {
    const s = readPowerlineSettings(ctx.cwd);
    const show = s.powerline && s.footer;
    if (show && !enabled) {
      enable(ctx);
    } else if (!show && enabled) {
      disable(ctx);
    } else if (enabled) {
      liveThinkLevel = pi.getThinkingLevel();
      liveTui?.requestRender();
    }
  });

  // re-evaluate on /powerline command (settings changed)
  pi.events.on('powerline_settings_changed', (ctx) => {
    const c = ctx as ExtensionContext;
    const s = readPowerlineSettings(c.cwd);
    const show = s.powerline && s.footer;
    if (show && !enabled) {
      enable(c);
    } else if (!show && enabled) {
      disable(c);
    } else if (enabled) {
      showFooterMcp = s['footer-mcp'];
      liveTui?.requestRender();
    }
  });

  // ── real-time token updates during streaming ──

  pi.on('agent_start', () => {
    isStreaming = true;
    liveAssistantUsage = null;
  });

  pi.on('message_update', (event) => {
    if (!enabled) return;
    if (isSessionAssistantMessage(event.message)) {
      liveAssistantUsage = event.message.usage;
      liveTui?.requestRender();
    }
  });

  pi.on('message_end', (event) => {
    isStreaming = false;
    if (!enabled) return;
    if (isSessionAssistantMessage(event.message)) {
      liveAssistantUsage =
        event.message.stopReason === 'error' || event.message.stopReason === 'aborted'
          ? null
          : event.message.usage;
    }
    liveTui?.requestRender();
  });
}
