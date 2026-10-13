/**
 * Custom Editor Extension
 *
 * Replaces the default editor with a bordered input area using a ❯ prompt prefix.
 * Switches to bash-mode coloring when the prompt starts with !.
 * Editor is always enabled; breadcrumb mode controls whether widget info is embedded.
 */
import { type EditorTheme, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  type ThemeColor,
} from '@earendil-works/pi-coding-agent';
import { getBreadcrumbData, renderBreadcrumbInfo } from './breadcrumb.ts';
import { readPowerlineSettings } from './settings.ts';
import { readPowerlineStyle, styleIcon } from './style.ts';
import { hexFg } from './utils.ts';

/** Pure transform: add > prompt prefix and borders to rendered editor lines. */
function renderPromptPrefix(
  lines: string[],
  width: number,
  borderChar: string,
  prefixChar: string,
  indentChar: string,
): string[] {
  if (lines.length < 3) return lines;

  let bottomIdx = lines.length - 1;
  for (let i = lines.length - 1; i >= 1; i--) {
    const stripped = (lines[i] ?? '').replace(/\x1b\[[0-9;]*m/g, '');
    if (stripped.length > 0 && /^─{3,}/.test(stripped)) {
      bottomIdx = i;
      break;
    }
  }

  const result: string[] = [];

  result.push(borderChar.repeat(width));

  for (let i = 1; i < bottomIdx; i++) {
    if (i === 1) {
      result.push(prefixChar + ' ' + (lines[i] ?? ''));
    } else {
      result.push(indentChar + ' ' + (lines[i] ?? ''));
    }
  }

  if (bottomIdx === 1) {
    result.push(prefixChar + ' ' + ' '.repeat(width - 2));
  }

  result.push(borderChar.repeat(width));

  for (let i = bottomIdx + 1; i < lines.length; i++) {
    result.push(lines[i] ?? '');
  }

  return result;
}

// live state, updated on enable / model_select
let liveCtx: ExtensionContext | null = null;
let liveThinkLevel = 'off';
let liveEditorTui: any = null;
let breadcrumbMode: string = 'inner';
let getSessionName = () => '';

/** A single border row, with the session title aligned at the right edge. */
export function renderEditorBorder(left: string, right: string, width: number, color: (text: string) => string): string {
  if (right && width >= 12) {
    const title = truncateToWidth(right, Math.min(Math.floor(width * 0.45), width - 8), '…');
    const info = truncateToWidth(left, Math.max(0, width - visibleWidth(title) - 8), '…');
    const gap = width - visibleWidth(info) - visibleWidth(title) - 6;
    return color('─') + ' ' + info + ' ' + color('─'.repeat(gap)) + ' ' + title + ' ' + color('─');
  }
  const info = truncateToWidth(left, Math.max(0, width - 5), '…');
  return info ? color('─') + ' ' + info + ' ' + color('─'.repeat(width - visibleWidth(info) - 3)) : color('─'.repeat(width));
}

let currentTheme: Theme | null = null;

/** Maps each editor element to a pi theme color token. @example PromptPrefixEditor.colorTokens.prefix = "success"; */
export interface PromptPrefixColorTokens {
  border?: ThemeColor;
  prefix?: ThemeColor;
  indent?: ThemeColor;
}

/** Custom editor with a ❯ prompt prefix. Colors use `PromptPrefixColorTokens`. */
export class PromptPrefixEditor extends CustomEditor {
  private readonly tuiRef: any;

  static colorTokens: PromptPrefixColorTokens = {
    border: 'borderAccent',
    prefix: 'dim',
    indent: 'border',
  };

  constructor(tui: any, theme: EditorTheme, keybindings: any) {
    super(tui, theme, keybindings);
    this.tuiRef = tui;
  }

  render(width: number): string[] {
    const terminalColumns = Number(this.tuiRef?.terminal?.columns);
    const renderWidth = Math.max(
      1,
      Math.floor(
        Number.isFinite(terminalColumns) && terminalColumns > 0
          ? Math.min(width, terminalColumns)
          : width,
      ),
    );
    const contentWidth = Math.max(1, renderWidth - 2);
    const lines = super.render(contentWidth);
    if (lines.length < 3) {
      return lines.map((line) => truncateToWidth(line, renderWidth, ''));
    }

    const theme = currentTheme;
    const color = (token: ThemeColor | undefined, text: string) =>
      token === 'borderAccent' ? hexFg(readPowerlineStyle(liveCtx?.cwd).colors.border, text)
        : !theme || !token ? text : theme.fg(token, text);

    // Bash mode: when text starts with !, switch to bashMode coloring
    const isBash = this.getText().trimStart().startsWith('!');
    const tokens = isBash
      ? {
          border: 'bashMode' as ThemeColor,
          prefix: 'bashMode' as ThemeColor,
          indent: 'bashMode' as ThemeColor,
        }
      : PromptPrefixEditor.colorTokens;

    const result = renderPromptPrefix(
      lines,
      renderWidth,
      color(tokens.border, '─'),
      color(tokens.prefix, '❯'),
      tokens.indent ? color(tokens.indent, ' ') : ' ',
    );

    let infoPart = '';
    if (breadcrumbMode === 'inner') {
      const ctx = liveCtx;
      if (ctx && theme) {
        const data = getBreadcrumbData(ctx, liveThinkLevel);
        infoPart = renderBreadcrumbInfo(data, theme, false);
      }
    }
    const style = readPowerlineStyle(liveCtx?.cwd);
    const name = getSessionName().replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
    const title = name && style.show.session && style.sessionPlacement === 'editor'
      ? hexFg(style.colors.session, styleIcon(style.icons.session, name)) : '';
    result[0] = renderEditorBorder(infoPart, title, renderWidth, text => color(tokens.border, text));

    return result.map((line) => truncateToWidth(line, renderWidth, ''));
  }
}

export function updateTheme(theme: Theme): void {
  currentTheme = theme;
}

/** Register the custom editor extension. Controlled by powerline master switch + breadcrumb mode. */
export function registerEditor(pi: ExtensionAPI) {
  getSessionName = () => pi.getSessionName() || '';
  let editorEnabled = false;

  function createEditorFactory() {
    return (tui: any, theme: EditorTheme, keybindings: any) => {
      liveEditorTui = tui;
      return new PromptPrefixEditor(tui, theme, keybindings);
    };
  }

  function enable(ctx: ExtensionContext) {
    liveThinkLevel = pi.getThinkingLevel();
    editorEnabled = true;
    liveCtx = ctx;
    currentTheme = ctx.ui.theme;
    breadcrumbMode = readPowerlineSettings(ctx.cwd).breadcrumb;
    ctx.ui.setEditorComponent(createEditorFactory());
  }

  function disable(ctx: ExtensionContext) {
    editorEnabled = false;
    liveEditorTui = null;
    ctx.ui.setEditorComponent(undefined);
  }

  // enable on session start if powerline master switch is on
  pi.on('session_start', (_event, ctx) => {
    if (readPowerlineSettings(ctx.cwd).powerline) {
      enable(ctx);
    }
  });

  // keep widget info in sync when model/cwd changes
  pi.on('model_select', (_event, ctx) => {
    liveThinkLevel = pi.getThinkingLevel();
    liveCtx = ctx;
    breadcrumbMode = readPowerlineSettings(ctx.cwd).breadcrumb;
    liveEditorTui?.requestRender();
  });

  pi.on('thinking_level_select', (event) => {
    liveThinkLevel = event.level;
    liveEditorTui?.requestRender();
  });
  pi.on('session_info_changed', () => {
    liveEditorTui?.requestRender();
  });

  // re-evaluate on /powerline command (settings changed)
  pi.events.on('powerline_settings_changed', (ctx) => {
    const c = ctx as ExtensionContext;
    const s = readPowerlineSettings(c.cwd);
    breadcrumbMode = s.breadcrumb;
    liveCtx = c;
    if (s.powerline && !editorEnabled) {
      enable(c);
    } else if (!s.powerline && editorEnabled) {
      disable(c);
    } else if (editorEnabled) {
      liveEditorTui?.requestRender();
    }
  });
}
