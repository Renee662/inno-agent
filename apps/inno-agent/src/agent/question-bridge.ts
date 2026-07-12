import { randomUUID } from "node:crypto";

export interface QuestionBridgeAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "chat" | "multi";
	answer: string | null;
	selected?: string[];
	notes?: string;
	preview?: string;
}

export interface QuestionBridgeResult {
	answers: QuestionBridgeAnswer[];
	cancelled: boolean;
	error?: string;
}

type SseEmitter = (data: unknown) => void;

interface PendingQuestion {
	questionId: string;
	sessionId?: string;
	params: unknown;
	title: string;
	createdAt: number;
	resolve: (result: QuestionBridgeResult) => void;
}

class QuestionBridge {
	private emitter: SseEmitter | null = null;
	private emitters = new Map<string, SseEmitter>();
	private pending = new Map<string, PendingQuestion>();

	setEmitter(fn: SseEmitter | null, sessionId?: string): void {
		if (sessionId) {
			if (fn) this.emitters.set(sessionId, fn);
			else this.emitters.delete(sessionId);
			return;
		}
		this.emitter = fn;
	}

	ask(params: unknown, context?: { sessionId?: string }): Promise<QuestionBridgeResult> {
		const emitter = context?.sessionId ? this.emitters.get(context.sessionId) ?? this.emitter : this.emitter;
		if (!emitter) {
			return Promise.resolve({ answers: [], cancelled: true, error: "no_ui" });
		}

		const questionId = randomUUID();

		return new Promise<QuestionBridgeResult>((resolve) => {
			this.pending.set(questionId, {
				questionId,
				sessionId: context?.sessionId,
				params,
				title: buildPendingQuestionTitle(params),
				createdAt: Date.now(),
				resolve,
			});
			emitter({ type: "question", questionId, params });
		});
	}

	respond(questionId: string, result: QuestionBridgeResult): boolean {
		const pending = this.pending.get(questionId);
		if (!pending) return false;
		const { resolve } = pending;
		this.pending.delete(questionId);
		resolve(result);
		return true;
	}

	hasPending(): boolean {
		return this.pending.size > 0;
	}

	listPending(): Array<{ questionId: string; sessionId?: string; title: string; createdAt: number; questionCount: number }> {
		return Array.from(this.pending.values()).map((item) => ({
			questionId: item.questionId,
			sessionId: item.sessionId,
			title: item.title,
			createdAt: item.createdAt,
			questionCount: getQuestionCount(item.params),
		}));
	}

	getPendingForSession(sessionId: string): { questionId: string; params: unknown } | null {
		const found = Array.from(this.pending.values()).find((item) => item.sessionId === sessionId);
		return found ? { questionId: found.questionId, params: found.params } : null;
	}

	cancel(): void {
		if (this.pending.size === 0) return;
		const pending = Array.from(this.pending.values());
		this.pending.clear();
		for (const item of pending) {
			item.resolve({ answers: [], cancelled: true, error: "disconnected" });
		}
	}
}

export const questionBridge = new QuestionBridge();

function getQuestionCount(params: unknown): number {
	if (!params || typeof params !== "object") return 0;
	const questions = (params as { questions?: unknown }).questions;
	return Array.isArray(questions) ? questions.length : 0;
}

function buildPendingQuestionTitle(params: unknown): string {
	if (!params || typeof params !== "object") return "选择题未完成";
	const questions = (params as { questions?: Array<{ header?: unknown; question?: unknown }> }).questions;
	const first = Array.isArray(questions) ? questions[0] : undefined;
	const raw = typeof first?.header === "string" && first.header.trim()
		? first.header.trim()
		: typeof first?.question === "string"
			? first.question.trim()
			: "选择题";
	const topic = raw.replace(/[。！？!?：:，,、\s]+$/g, "").slice(0, 18);
	return `${topic || "选择题"}未完成`;
}
