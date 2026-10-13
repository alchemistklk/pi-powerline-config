import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_STYLE = {
  "sessionPlacement": "footer" as 'footer' | 'editor',
  "colors": {
    "border": "#00afaf",
    "model": "#d787af",
    "thinking": "#c2c0b6",
    "folder": "#d7d7d7",
    "branch": "#d7af5f",
    "context": "#d7a0b8",
    "tokens": "#5fd7af",
    "status": "#a7adb8",
    "session": "#5fafff",
    "pr": "#e5a16b",
    "prDraft": "#B0B0B0",
    "prMerged": "#C586C0",
    "ciPass": "#89D185",
    "ciFail": "#F48771",
    "ciPending": "#E2C08D",
    "ciUnknown": "#B0B0B0",
    "prStale": "#B0B0B0"
  },
  "icons": {
    "model": "",
    "folder": "",
    "branch": "",
    "context": "󰆏",
    "cache": "",
    "mcp": "󰒋",
    "session": "󰦨",
    "pr": ""
  },
  "show": {
    "breadcrumbFolder": false,
    "thinking": true,
    "folder": true,
    "branch": true,
    "context": true,
    "tokens": true,
    "session": true,
    "pr": true,
    "prDetails": true
  },
  "hiddenStatuses": [
    "lsp"
  ],
  "separator": " │ "
};
export type PowerlineStyle = typeof DEFAULT_STYLE;

/** Global style, then optional project override. Invalid values retain defaults. */
export function readPowerlineStyle(cwd = process.cwd()): PowerlineStyle {
  const result = JSON.parse(JSON.stringify(DEFAULT_STYLE)) as PowerlineStyle;
  for (const path of [join(homedir(), '.pi/agent/powerline-style.json'), join(cwd, '.pi/powerline-style.json')]) {
    let value: any;
    try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
    if (!value || typeof value !== 'object') continue;
    if (value.sessionPlacement === 'footer' || value.sessionPlacement === 'editor') result.sessionPlacement = value.sessionPlacement;
    for (const key of Object.keys(result.colors) as (keyof PowerlineStyle['colors'])[]) {
      if (typeof value.colors?.[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value.colors[key])) result.colors[key] = value.colors[key];
    }
    for (const key of Object.keys(result.icons) as (keyof PowerlineStyle['icons'])[]) {
      if (typeof value.icons?.[key] === 'string' && !/[\x00-\x1f\x7f]/.test(value.icons[key])) result.icons[key] = value.icons[key];
    }
    for (const key of Object.keys(result.show) as (keyof PowerlineStyle['show'])[]) {
      if (typeof value.show?.[key] === 'boolean') result.show[key] = value.show[key];
    }
    if (Array.isArray(value.hiddenStatuses) && value.hiddenStatuses.every((s: unknown) => typeof s === 'string' && s.length > 0)) result.hiddenStatuses = value.hiddenStatuses;
    if (typeof value.separator === 'string' && !/[\x00-\x1f\x7f]/.test(value.separator)) result.separator = value.separator;
  }
  return result;
}

export function styleIcon(icon: string, text: string): string {
  return icon ? `${icon} ${text}` : text;
}
