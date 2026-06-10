import * as Lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { logger } from "../../logger.js";

export interface FeishuConfig {
	appId: string;
	appSecret: string;
}

/** Map a file extension to a Feishu file_type. Unknown types fall back to "stream". */
function feishuFileType(fileName: string): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
	const ext = extname(fileName).toLowerCase().replace(/^\./, "");
	switch (ext) {
		case "opus":
			return "opus";
		case "mp4":
			return "mp4";
		case "pdf":
			return "pdf";
		case "doc":
		case "docx":
			return "doc";
		case "xls":
		case "xlsx":
			return "xls";
		case "ppt":
		case "pptx":
			return "ppt";
		default:
			return "stream";
	}
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

function isImageFile(fileName: string): boolean {
	const ext = extname(fileName).toLowerCase().replace(/^\./, "");
	return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Feishu API client using the official SDK.
 * Handles authentication automatically.
 */
export class FeishuAPI {
	readonly client: Lark.Client;
	private static readonly MAX_SEGMENT_CHARS = 3500;

	constructor(config: FeishuConfig) {
		this.client = new Lark.Client({
			appId: config.appId,
			appSecret: config.appSecret,
			appType: Lark.AppType.SelfBuild,
			domain: Lark.Domain.Feishu,
		});
	}

	/**
	 * Reply to a message by message_id.
	 */
	async replyMessage(messageId: string, text: string): Promise<void> {
		const posts = this.buildMarkdownPosts(text, "Inno Agent");
		for (let i = 0; i < posts.length; i++) {
			const post = posts[i];
			const resp = await this.client.im.v1.message.reply({
				path: { message_id: messageId },
				data: {
					content: JSON.stringify({
						zh_cn: {
							title: post.title,
							content: post.content,
						},
					}),
					msg_type: "post",
				},
			});
			if (resp.code !== 0) {
				logger.error({ code: resp.code, msg: resp.msg, part: i + 1, total: posts.length }, "Feishu reply error");
				throw new Error(`Feishu reply failed: ${resp.msg} (code: ${resp.code})`);
			}
		}
	}

	/**
	 * Send a message to a chat by chat_id.
	 */
	async sendMessage(chatId: string, text: string): Promise<void> {
		const posts = this.buildMarkdownPosts(text, "Inno Agent");
		for (let i = 0; i < posts.length; i++) {
			const post = posts[i];
			const resp = await this.client.im.v1.message.create({
				params: { receive_id_type: "chat_id" },
				data: {
					receive_id: chatId,
					content: JSON.stringify({
						zh_cn: {
							title: post.title,
							content: post.content,
						},
					}),
					msg_type: "post",
				},
			});
			if (resp.code !== 0) {
				logger.error({ code: resp.code, msg: resp.msg, part: i + 1, total: posts.length }, "Feishu push send error");
				throw new Error(`Feishu send failed: ${resp.msg} (code: ${resp.code})`);
			}
		}
	}

	/**
	 * Upload a local file and send it to a chat as a file (or image) message.
	 * Images are routed through the image upload API + `image` message type;
	 * everything else uses the file upload API + `file` message type.
	 */
	async sendFile(chatId: string, filePath: string, fileName?: string): Promise<void> {
		const name = fileName ?? basename(filePath);
		const buffer = readFileSync(filePath);

		if (isImageFile(name)) {
			const upload = await this.client.im.v1.image.create({
				data: { image_type: "message", image: buffer },
			});
			if (!upload?.image_key) {
				throw new Error("Feishu image upload failed: no image_key returned");
			}
			const resp = await this.client.im.v1.message.create({
				params: { receive_id_type: "chat_id" },
				data: {
					receive_id: chatId,
					content: JSON.stringify({ image_key: upload.image_key }),
					msg_type: "image",
				},
			});
			if (resp.code !== 0) {
				throw new Error(`Feishu image send failed: ${resp.msg} (code: ${resp.code})`);
			}
			return;
		}

		const upload = await this.client.im.v1.file.create({
			data: {
				file_type: feishuFileType(name),
				file_name: name,
				file: buffer,
			},
		});
		if (!upload?.file_key) {
			throw new Error("Feishu file upload failed: no file_key returned");
		}
		const resp = await this.client.im.v1.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: chatId,
				content: JSON.stringify({ file_key: upload.file_key }),
				msg_type: "file",
			},
		});
		if (resp.code !== 0) {
			throw new Error(`Feishu file send failed: ${resp.msg} (code: ${resp.code})`);
		}
	}

	private buildMarkdownPosts(
		text: string,
		fallbackTitle: string,
	): Array<{ title: string; content: Array<Array<{ tag: "md"; text: string }>> }> {
		const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
		const lines = normalized.length > 0 ? normalized.split("\n") : [fallbackTitle];
		const heading = lines.find((line) => /^#{1,6}\s+/.test(line)) ?? "";
		const baseTitle = heading ? heading.replace(/^#{1,6}\s+/, "").trim().slice(0, 60) || fallbackTitle : fallbackTitle;

		const chunks = this.splitMarkdownBlocks(lines, normalized || fallbackTitle);
		const segments: string[][] = [];
		let current: string[] = [];
		let currentLen = 0;
		for (const chunk of chunks) {
			if (chunk.length > FeishuAPI.MAX_SEGMENT_CHARS) {
				if (current.length > 0) {
					segments.push(current);
					current = [];
					currentLen = 0;
				}
				segments.push(this.splitLongBlock(chunk));
				continue;
			}
			const nextLen = currentLen + chunk.length + (current.length > 0 ? 2 : 0);
			if (nextLen > FeishuAPI.MAX_SEGMENT_CHARS && current.length > 0) {
				segments.push(current);
				current = [chunk];
				currentLen = chunk.length;
			} else {
				current.push(chunk);
				currentLen = nextLen;
			}
		}
		if (current.length > 0) {
			segments.push(current);
		}
		if (segments.length === 0) {
			segments.push([normalized || fallbackTitle]);
		}

		return segments.map((segmentChunks, idx) => {
			const title = segments.length > 1 ? `${baseTitle} (${idx + 1}/${segments.length})` : baseTitle;
			return {
				title,
				content: segmentChunks.map((chunk) => [{ tag: "md" as const, text: chunk }]),
			};
		});
	}

	private splitMarkdownBlocks(lines: string[], fallback: string): string[] {
		const chunks: string[] = [];
		let current: string[] = [];
		let inFence = false;
		for (const line of lines) {
			if (/^\s*```/.test(line)) {
				inFence = !inFence;
			}
			if (!inFence && line.trim() === "") {
				if (current.length > 0) {
					chunks.push(current.join("\n"));
					current = [];
				}
				continue;
			}
			current.push(line);
		}
		if (current.length > 0) {
			chunks.push(current.join("\n"));
		}
		if (chunks.length === 0) {
			chunks.push(fallback);
		}
		return chunks;
	}

	private splitLongBlock(block: string): string[] {
		const pieces: string[] = [];
		const lines = block.split("\n");
		let current: string[] = [];
		let currentLen = 0;
		for (const line of lines) {
			const nextLen = currentLen + line.length + (current.length > 0 ? 1 : 0);
			if (nextLen > FeishuAPI.MAX_SEGMENT_CHARS && current.length > 0) {
				pieces.push(current.join("\n"));
				current = [line];
				currentLen = line.length;
			} else {
				current.push(line);
				currentLen = nextLen;
			}
		}
		if (current.length > 0) {
			pieces.push(current.join("\n"));
		}
		return pieces.length > 0 ? pieces : [block];
	}
}
