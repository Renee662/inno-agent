import { apiFetch, streamSSE, streamSSEGet } from "./client.js";
import type { ChatStreamEvent, PendingQuestion, PendingQuestionItem } from "../types/chat.js";

export interface InlineImage {
	data: string;
	mimeType: string;
}

export async function postChat(prompt: string, sessionId?: string | null, images?: InlineImage[]): Promise<string> {
	const res = await apiFetch<{ response: string }>("/api/chat", {
		method: "POST",
		body: JSON.stringify({ prompt, sessionId: sessionId ?? undefined, images: images?.length ? images : undefined }),
	});
	return res.response;
}

export function streamChat(prompt: string, sessionId?: string | null, signal?: AbortSignal, images?: InlineImage[]): AsyncGenerator<ChatStreamEvent> {
	return streamSSE<ChatStreamEvent>("/api/chat/stream", { prompt, sessionId: sessionId ?? undefined, images: images?.length ? images : undefined }, signal);
}

/**
 * Explicitly tell the backend to abort the currently running prompt. Best-effort:
 * connection-close from aborting the SSE fetch is unreliable through dev proxies,
 * so the UI calls this to deterministically release the server's prompt queue.
 */
export async function abortChat(): Promise<void> {
	try {
		await fetch("/api/chat/abort", { method: "POST" });
	} catch {
		// best-effort — the SSE close handler is a fallback
	}
}

export interface ChatStatus {
	hasPendingQuestion: boolean;
	pendingQuestions: PendingQuestionItem[];
}

export async function getChatStatus(): Promise<ChatStatus> {
	return apiFetch<ChatStatus>("/api/chat/status");
}

export async function getPendingQuestionForSession(sessionId: string): Promise<PendingQuestion | null> {
	const res = await apiFetch<{ pendingQuestion: PendingQuestion | null }>(`/api/chat/pending-question?sessionId=${encodeURIComponent(sessionId)}`);
	return res.pendingQuestion;
}

/**
 * Reconnect to an in-progress session's event stream. Returns silently
 * if the session has no active stream (404).
 */
export function streamSessionEvents(sessionId: string, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
	return streamSSEGet<ChatStreamEvent>(`/api/chat/events/${encodeURIComponent(sessionId)}`, signal);
}
