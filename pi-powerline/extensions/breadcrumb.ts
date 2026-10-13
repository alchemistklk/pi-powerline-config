/**
 * Shared breadcrumb display helpers
 *
 * Exports icons and helper functions used by widget.ts and editor.ts
 * to render the model→folder breadcrumb.
 */
import { basename } from 'node:path';
import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { hasNerdFonts, hexFg, withIcon } from './utils.ts';

import { readPowerlineStyle, styleIcon, type PowerlineStyle } from './style.ts';

const NERD = hasNerdFonts();

export const ICON_MODEL = NERD ? '\uF4BC' : '';
export const ICON_FOLDER = NERD ? '\uF115' : '';
export const SEP = NERD ? '\uf054' : '/';

// ═══════════════════════════════════════════════════════════════════════════
// breadcrumb data
// ═══════════════════════════════════════════════════════════════════════════

export interface BreadcrumbData {
  modelName: string;
  folder: string;
  modelText: string; // icon + modelName
  folderText: string; // icon + folder
  thinkingText: string;
  style: PowerlineStyle;
}

export function getBreadcrumbData(ctx: ExtensionContext | null, thinkingLevel = 'off'): BreadcrumbData {
  const style = readPowerlineStyle(ctx?.cwd);
  const cwd = ctx?.cwd ?? process.cwd();
  const folder = basename(cwd) || cwd;
  const modelName = ctx?.model?.name || ctx?.model?.id || 'no-model';

  return {
    style,
    modelName,
    folder,
    modelText: styleIcon(style.icons.model, modelName),
    folderText: styleIcon(style.icons.folder, folder),
    thinkingText: style.show.thinking && ctx?.model?.reasoning ? (({minimal:'min',medium:'med',xhigh:'xhi'} as Record<string, string>)[thinkingLevel] ?? thinkingLevel) : '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// breadcrumb info renderer (model and thinking level, colored)
// ═══════════════════════════════════════════════════════════════════════════

/** Render model and thinking level. The folder is already displayed in the footer. */
export function renderBreadcrumbInfo(data: BreadcrumbData, theme: Theme, reset = false): string {
  const line =
    hexFg(data.style.colors.model, data.modelText) +
    (data.thinkingText ? hexFg(data.style.colors.thinking, ` · ${data.thinkingText}`) : '') +
    (data.style.show.breadcrumbFolder ? theme.fg('dim', ` ${SEP} `) + hexFg(data.style.colors.folder, data.folderText) : '');
  return reset ? line + '\x1b[0m' : line;
}
