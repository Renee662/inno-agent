import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { terminalStore } from "../../stores/terminal-store.js";
import { themeStore, type ThemeId } from "../../stores/theme-store.js";

interface TerminalViewProps {
	innoSessionId: string;
	workspaceId?: string;
	className?: string;
}

// Per-theme xterm color schemes. Light themes use a light terminal palette;
// dark themes use a dark one. Keys match ThemeId values.
const TERMINAL_THEMES: Record<ThemeId, ITheme> = {
	light: {
		background: "#ffffff",
		foreground: "#1e293b",
		cursor: "#334155",
		cursorAccent: "#ffffff",
		selectionBackground: "#cbd5e1",
		black: "#1e293b", red: "#dc2626", green: "#16a34a", yellow: "#d97706",
		blue: "#2563eb", magenta: "#9333ea", cyan: "#0891b2", white: "#475569",
		brightBlack: "#64748b", brightRed: "#ef4444", brightGreen: "#22c55e",
		brightYellow: "#f59e0b", brightBlue: "#3b82f6", brightMagenta: "#a855f7",
		brightCyan: "#06b6d4", brightWhite: "#1e293b",
	},
	warm: {
		background: "#fffefa", foreground: "#2c2418", cursor: "#7a6b5a",
		cursorAccent: "#fffefa", selectionBackground: "#e5ddd4",
		black: "#2c2418", red: "#dc2626", green: "#16a34a", yellow: "#d97706",
		blue: "#0d9488", magenta: "#9333ea", cyan: "#0891b2", white: "#7a6b5a",
		brightBlack: "#9a8b7a", brightRed: "#ef4444", brightGreen: "#22c55e",
		brightYellow: "#f59e0b", brightBlue: "#14b8a6", brightMagenta: "#a855f7",
		brightCyan: "#06b6d4", brightWhite: "#2c2418",
	},
	ocean: {
		background: "#f8fafb", foreground: "#1a2c3d", cursor: "#5a7088",
		cursorAccent: "#f8fafb", selectionBackground: "#d0dae4",
		black: "#1a2c3d", red: "#dc2626", green: "#059669", yellow: "#d97706",
		blue: "#0891b2", magenta: "#9333ea", cyan: "#0d9488", white: "#5a7088",
		brightBlack: "#7a92a8", brightRed: "#ef4444", brightGreen: "#10b981",
		brightYellow: "#f59e0b", brightBlue: "#06b6d4", brightMagenta: "#a855f7",
		brightCyan: "#14b8a6", brightWhite: "#1a2c3d",
	},
};

/**
 * Mounts an xterm.js instance and wires it to the global terminalStore.
 * The store handles WS create/close + protocol. This component only owns the
 * DOM-level xterm + addon-fit lifecycle.
 */
export function TerminalView({ innoSessionId, workspaceId, className }: TerminalViewProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const term = new Terminal({
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
			fontSize: 13,
			cursorBlink: true,
			convertEol: true,
			theme: TERMINAL_THEMES[themeStore.current],
			scrollback: 5000,
		});
		const fit = new FitAddon();
		const links = new WebLinksAddon();
		term.loadAddon(fit);
		term.loadAddon(links);
		term.open(host);
		try { fit.fit(); } catch { /* container may not have layout yet */ }

		// Input → server
		const inputSub = term.onData((data) => {
			terminalStore.input(data);
		});

		// Server → xterm
		const offOutput = terminalStore.on("output", (chunk) => {
			term.write(chunk);
		});

		// Connect (idempotent if same session is already wired).
		void terminalStore.connect(innoSessionId, workspaceId, term.cols, term.rows);

		// Resize tracking
		const ro = new ResizeObserver(() => {
			try {
				fit.fit();
				terminalStore.resize(term.cols, term.rows);
			} catch {
				// ignore transient layout errors
			}
		});
		ro.observe(host);

		// React to theme switches live.
		const offTheme = themeStore.on("change", () => {
			term.options.theme = TERMINAL_THEMES[themeStore.current];
		});

		return () => {
			ro.disconnect();
			offOutput();
			offTheme();
			inputSub.dispose();
			term.dispose();
		};
		// Intentionally re-mount xterm only when innoSessionId/workspaceId change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [innoSessionId, workspaceId]);

	return <div ref={hostRef} className={className ?? "h-full w-full"} />;
}
