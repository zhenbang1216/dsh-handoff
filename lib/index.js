import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "@deepseek-ai/schemastery";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
// src/config.ts
/**
* Plain configuration. These are ordinary profile-entry values: a change is
* saved to the profile patch and takes effect on the next mount, which is the
* right granularity for a batch job like this one. (`volatile()` is for config
* references and would turn every value into a reference object.)
*/
const Config = Schema.object({
	outputDir: Schema.string().default(".dsh/handoff").description("生成目录，相对于会话工作目录。"),
	filenamePrefix: Schema.string().default("handoff").description("文件名前缀，例如 handoff-20261025-2140-xxx.md。"),
	writeLatest: Schema.boolean().default(true).description("同时写一份 latest.md，方便下一个会话直接读取。"),
	provider: Schema.string().default("").description("模型 provider；与 model 同时填写才生效，否则沿用会话当前模型。"),
	model: Schema.string().default("").description("模型 id；与 provider 同时填写才生效。"),
	maxInputChars: Schema.number().default(48e3).min(4e3).description("会话记录的字符预算，超出时省略中间部分。"),
	maxOutputTokens: Schema.number().default(4096).min(512).description("生成交接文档的输出 token 上限。"),
	includeToolResults: Schema.boolean().default(true).description("把工具结果写入会话记录（整段截断）。"),
	includeInjectedContext: Schema.boolean().default(false).description("把宿主注入的上下文（技能目录、工作区说明等）也写进记录；默认排除，避免挤占预算。"),
	includeReasoning: Schema.boolean().default(false).description("把助手的思考过程写入会话记录。"),
	language: Schema.union([
		"auto",
		"zh",
		"en"
	]).default("auto").description("文档语言：auto 跟随对话，或固定中文 / 英文。"),
	extraInstructions: Schema.string().default("").description("追加到总结提示词的额外要求。")
});
// src/errors.ts
/** A failure with a stable machine code, safe to surface in a command result. */
var HandoffError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.code = code;
		this.name = "HandoffError";
	}
};
/** Render any thrown value as a short, user-facing line. */
function describeError(error) {
	if (error instanceof HandoffError) return `${error.code}: ${error.message}`;
	if (error instanceof Error) return error.message;
	return String(error);
}
// src/markdown.ts
function yamlString(value) {
	if (/^[\w./@-]+$/u.test(value)) return value;
	return JSON.stringify(value);
}
/** `2026-10-26 15:36:12 +08:00` — readable, unambiguous, sortable. */
function readableTime(iso) {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})$/u.exec(iso);
	return match === null ? iso : `${match[1]} ${match[2]} ${match[3]}`;
}
/** One line under the title: version, freshness, and the version it replaces. */
function metaLine(meta) {
	const parts = [
		`v${meta.version}`,
		`生成于 ${readableTime(meta.createdAt)}`,
		`会话最后活动 ${readableTime(meta.sessionActivityAt)}`
	];
	if (meta.previous !== void 0 && meta.previous !== "") parts.push(`上一份 \`${meta.previous}\``);
	return `> ${parts.join(" · ")}`;
}
/** Render the complete document: YAML front matter, title, meta line, and model-written body. */
function renderDocument(meta, body) {
	const fields = [
		["title", yamlString(meta.title)],
		["session", yamlString(meta.sessionId)],
		["cwd", yamlString(meta.cwd)],
		["created", yamlString(meta.createdAt)],
		["updated", yamlString(meta.updatedAt)],
		["version", meta.version],
		["session-activity", yamlString(meta.sessionActivityAt)]
	];
	if (meta.previous !== void 0 && meta.previous !== "") fields.push(["previous", yamlString(meta.previous)]);
	fields.push(["provider", yamlString(meta.provider)]);
	fields.push(["model", yamlString(meta.model)]);
	fields.push(["messages", meta.messages]);
	if (meta.focus !== void 0 && meta.focus !== "") fields.push(["focus", yamlString(meta.focus)]);
	fields.push(["generator", yamlString(meta.generator)]);
	return `${[
		"---",
		...fields.map(([key, value]) => `${key}: ${value}`),
		"---"
	].join("\n")}\n\n# 交接文档 · ${meta.title}\n\n${metaLine(meta)}\n\n${body.trim()}\n`;
}
/**
* Render `latest.md` as a pointer rather than a duplicate.
*
* A full copy made "which file is newest" ambiguous (two identical files with
* the same mtime). The pointer states the answer and keeps `latest.md` cheap;
* `/handoff resume` follows it to the real document.
*/
function renderLatestPointer(meta) {
	return `${[
		"---",
		"kind: latest-pointer",
		`latest: ${yamlString(meta.name)}`,
		`version: ${meta.version}`,
		`updated: ${yamlString(meta.updatedAt)}`,
		"---"
	].join("\n")}\n\n${[
		"# 最新交接文档",
		"",
		`最新一份是 \`${meta.name}\`（v${meta.version}，${readableTime(meta.updatedAt)}）。`,
		"",
		"直接打开它；或者在新会话里运行 `/handoff resume`，会自动跟上这里指向的文件。"
	].join("\n")}\n`;
}
/** Read `latest: <name>` out of a pointer document; `undefined` for a legacy full copy. */
function parseLatestPointer(content) {
	const front = /^---\n([\s\S]*?)\n---/u.exec(content);
	if (front === null) return void 0;
	return /^latest:\s*"?([^"\n]+)"?\s*$/mu.exec(front[1] ?? "")?.[1]?.trim();
}
/** Read the `version:` counter out of an existing document. */
function parseDocumentVersion(content) {
	const field = /^version:\s*(\d+)\s*$/mu.exec(content);
	if (field === null) return void 0;
	const value = Number(field[1]);
	return Number.isSafeInteger(value) && value > 0 ? value : void 0;
}
/**
* Clean model output: drop an accidental whole-document fence, a duplicated
* front matter block, or a top-level heading the prompt asked it not to add.
*/
function normalizeBody(raw) {
	let body = raw.trim();
	const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/u.exec(body);
	if (fence?.[1] !== void 0) body = fence[1].trim();
	if (body.startsWith("---\n")) {
		const end = body.indexOf("\n---", 4);
		if (end !== -1) body = body.slice(end + 4).trim();
	}
	body = body.replace(/^# [^\n]*\n+/u, "");
	return body.trim();
}
/** File-name-safe slug that keeps CJK characters. */
function slugify(text, maxChars = 28) {
	const slug = text.normalize("NFKC").toLowerCase().replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, maxChars).replace(/-+$/u, "");
	return slug === "" ? "session" : slug;
}
/** `20261025-2140` in the host's local time, sortable as a file name. */
function stamp(date) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
/** Build the timestamped document file name. */
function documentFileName(prefix, date, slug) {
	return `${slugify(prefix, 24)}-${stamp(date)}-${slug}.md`;
}
/** ISO-ish local timestamp for front matter and prompts. */
function localTimestamp(date) {
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const pad = (value) => String(Math.trunc(Math.abs(value))).padStart(2, "0");
	return `${(/* @__PURE__ */ new Date(date.getTime() - date.getTimezoneOffset() * 6e4)).toISOString().slice(0, 19)}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}
// src/prompt.ts
const SECTIONS_ZH = [
	"## 任务",
	"## 已完成",
	"## 当前进展",
	"## 下一步",
	"## 未完成 / 风险",
	"## 踩坑与规避",
	"## 关键文件与命令",
	"## 给下一个会话的开场白"
];
const SECTIONS_EN = [
	"## Task",
	"## Done",
	"## Where things stand",
	"## Next steps",
	"## Open items and risks",
	"## Traps and how to avoid them",
	"## Key files and commands",
	"## Opening message for the next session"
];
const SYSTEM_ZH = `你是 DeepSeek Harness 的交接文档撰写器。用户会给你一段编程会话记录（用户、助手、工具调用与结果）。你的读者是「下一个接手这个任务的 AI 会话」——它完全没有这段对话的上下文，只有你写的这份文档。

写作要求：
1. 只写记录里能证实的事实。不确定的地方写「待确认」，不要猜测、不要补全。
2. 具体优先：文件名、命令、报错原文、接口名、关键数值，以及做出某个决定的理由。
3. 不复述对话，不写寒暄和过程流水账；读者要的是状态与判断，不是剧情。
4. 只输出 markdown 正文：不要一级标题，不要用代码块包住整篇文档。
5. 严格按下面小节与顺序输出，一个都不能少；某节确实没有内容时写「（无）」：
${SECTIONS_ZH.join("\n")}
6. 总长度控制在 1200 字以内，信息密度优先。
7. 「给下一个会话的开场白」必须是一段可直接粘贴的话：要读哪些文件、当前状态、第一件要做的事。`;
const SYSTEM_EN = `You write handoff documents for DeepSeek Harness. The user gives you a programming session transcript (user, assistant, tool calls and results). Your reader is "the next AI session that takes over this work" — it has none of this conversation's context, only your document.

Rules:
1. State only what the transcript supports. Mark unknowns as "unconfirmed"; never guess or fill gaps.
2. Prefer specifics: file paths, commands, verbatim error text, API names, key numbers, and why a decision was made.
3. Do not retell the conversation. No pleasantries, no play-by-play; the reader needs state and judgement.
4. Output markdown body only: no top-level heading, no code fence around the whole document.
5. Follow these sections in this exact order. Never skip one; write "(none)" when a section genuinely has nothing:
${SECTIONS_EN.join("\n")}
6. Keep it under 800 words. Density beats completeness.
7. "Opening message for the next session" must be a ready-to-paste paragraph: what to read, where things stand, and the first action.`;
function line(label, value) {
	return `- ${label}：${value}`;
}
function lineEn(label, value) {
	return `- ${label}: ${value}`;
}
/** Build the summarizer prompt for one session. */
function buildPrompt(input) {
	const zh = input.language === "zh";
	const system = zh ? SYSTEM_ZH : SYSTEM_EN;
	const meta = zh ? [
		line("工作目录", input.cwd),
		line("会话 ID", input.sessionId),
		line("生成时间", input.createdAt),
		line("模型", input.model),
		line("消息数", input.messageCount),
		line("记录是否被截断", input.truncated ? "是（中间部分已省略）" : "否")
	] : [
		lineEn("Working directory", input.cwd),
		lineEn("Session", input.sessionId),
		lineEn("Generated at", input.createdAt),
		lineEn("Model", input.model),
		lineEn("Messages", input.messageCount),
		lineEn("Transcript truncated", input.truncated ? "yes (middle omitted)" : "no")
	];
	if (input.focus !== "") meta.push(zh ? `- 本次关注点：${input.focus}` : `- Focus for this handoff: ${input.focus}`);
	if (input.extraInstructions !== "") meta.push(zh ? `- 额外要求：${input.extraInstructions}` : `- Extra requirements: ${input.extraInstructions}`);
	const header = zh ? "会话信息" : "Session facts";
	const recordLabel = zh ? "会话记录" : "Session transcript";
	const footer = zh ? "请按要求的格式输出交接文档正文。" : "Write the handoff document body in the required format.";
	return {
		system,
		user: `${header}\n${meta.join("\n")}\n\n<${recordLabel}>\n${input.transcript}\n</${recordLabel}>\n\n${footer}`
	};
}
// src/store.ts
const DEFAULT_DIR = ".dsh/handoff";
/** Resolve the configured output directory against the session working directory. */
function resolveOutputDir(cwd, configured) {
	const value = configured.trim() === "" ? DEFAULT_DIR : configured.trim();
	return isAbsolute(value) ? normalize(value) : resolve(cwd, value);
}
/**
* Accept one bare file name, on any platform.
*
* Both separators are rejected explicitly: on POSIX a name like
* `..\escape.md` contains no `/` and would otherwise pass a `basename` check
* while still being a Windows path traversal on the other side.
*/
function assertBareName(name) {
	if (name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) throw new HandoffError("BAD_NAME", `非法的文件名：${name}`);
}
/** Write one document, creating the directory when needed. */
async function writeDocument(dir, name, content) {
	assertBareName(name);
	await mkdir(dir, { recursive: true });
	const target = join(dir, name);
	await writeFile(target, content, "utf8");
	return target;
}
/** Newest documents first, without the `latest.md` convenience copy. */
async function listDocuments(dir, limit = 50) {
	let names;
	try {
		names = await readdir(dir);
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	const entries = [];
	for (const name of names) {
		if (!name.endsWith(".md") || name === "latest.md") continue;
		const path = join(dir, name);
		const info = await stat(path);
		if (!info.isFile()) continue;
		entries.push({
			name,
			path,
			size: info.size,
			modifiedAt: info.mtimeMs
		});
	}
	entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
	return entries.slice(0, limit);
}
/** Read one document by bare file name. */
async function readDocument(dir, name) {
	assertBareName(name);
	return readFile(join(dir, name), "utf8");
}
// src/transcript.ts
const ENTRY_LIMIT = 4e3;
const ENTRY_HEAD = 2600;
const ENTRY_TAIL = 1200;
const CALL_ARGS_LIMIT = 500;
function clip(text, limit = ENTRY_LIMIT) {
	if (text.length <= limit) return text;
	const omitted = text.length - ENTRY_HEAD - ENTRY_TAIL;
	return `${text.slice(0, ENTRY_HEAD)}\n…（此处截断 ${omitted} 字符）…\n${text.slice(text.length - ENTRY_TAIL)}`;
}
/** Flatten content blocks into readable text, skipping images and files. */
function contentText(blocks, includeReasoning) {
	const parts = [];
	for (const block of blocks) if (block.type === "text") parts.push(block.text);
	else if (block.type === "reasoning" && includeReasoning) parts.push(`[思考] ${block.text}`);
	else if (block.type === "image") parts.push("[图片]");
	else if (block.type === "file") parts.push("[文件]");
	return parts.join("\n").trim();
}
/** Pretty-print raw tool arguments without inventing content. */
function argumentsText(raw) {
	let text = raw.trim();
	try {
		text = JSON.stringify(JSON.parse(text));
	} catch {}
	return text.length > CALL_ARGS_LIMIT ? `${text.slice(0, CALL_ARGS_LIMIT)}…` : text;
}
function toolNameOf(message, names) {
	if (message.role !== "tool") return "tool";
	return names.get(String(message.source.callId)) ?? "tool";
}
/** Collect `callId → tool name` so results can name their call. */
function collectToolNames(messages) {
	const names = /* @__PURE__ */ new Map();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const block of message.content) if (block.type === "tool-call") names.set(String(block.id), block.name);
	}
	return names;
}
function toEntries(messages, options) {
	const names = collectToolNames(messages);
	const entries = [];
	for (const message of messages) switch (message.role) {
		case "system":
		case "developer": break;
		case "user": {
			const injected = message.source.kind !== "user";
			if (injected && !options.includeInjectedContext) break;
			const text = contentText(message.content, options.includeReasoning);
			if (text === "") break;
			entries.push({
				kind: injected ? "context" : "user",
				text: clip(text)
			});
			break;
		}
		case "assistant": {
			const text = contentText(message.content, options.includeReasoning);
			if (text !== "") entries.push({
				kind: "assistant",
				text: clip(text)
			});
			for (const block of message.content) {
				if (block.type !== "tool-call") continue;
				entries.push({
					kind: "tool-call",
					callId: String(block.id),
					text: clip(`→ ${block.name} ${argumentsText(block.arguments)}`, 900)
				});
			}
			break;
		}
		case "tool": {
			if (!options.includeToolResults) break;
			const text = contentText(message.content, false);
			const name = toolNameOf(message, names);
			const label = message.isError === true ? `✗ ${name}` : `← ${name}`;
			entries.push({
				kind: "tool-result",
				callId: String(message.source.callId),
				text: clip(`${label} ${text}`, 1200)
			});
			break;
		}
	}
	return entries;
}
function renderEntry(entry) {
	switch (entry.kind) {
		case "user": return `[用户] ${entry.text}`;
		case "context": return `[上下文] ${entry.text}`;
		case "assistant": return `[助手] ${entry.text}`;
		case "tool-call": return `[调用] ${entry.text.replace(/^→ /u, "")}`;
		case "tool-result": return `[结果] ${entry.text}`;
		case "reasoning": return `[思考] ${entry.text}`;
	}
}
/**
* Render the conversation into a compact transcript under a character budget.
*
* The budget keeps the beginning (the task statement) and the newest entries
* (where the work actually is), dropping the middle with an explicit marker so
* the summarizer knows the record is incomplete instead of silently missing it.
*/
function buildTranscript(messages, options) {
	const entries = toEntries(messages, options);
	const budget = Math.max(2e3, options.maxChars);
	const rendered = entries.map(renderEntry);
	const total = rendered.reduce((sum, text) => sum + text.length + 2, 0);
	if (total <= budget) {
		const text = rendered.join("\n\n");
		return {
			text,
			stats: {
				messages: messages.length,
				included: entries.length,
				chars: text.length,
				truncated: false,
				omitted: 0
			}
		};
	}
	const headBudget = Math.floor(budget * .35);
	const tailBudget = Math.max(1e3, budget - headBudget - 240);
	const head = [];
	let headChars = 0;
	for (const text of rendered) {
		if (headChars + text.length + 2 > headBudget) break;
		head.push(text);
		headChars += text.length + 2;
	}
	const tail = [];
	let tailChars = 0;
	for (let index = rendered.length - 1; index >= head.length; index--) {
		const text = rendered[index];
		if (tailChars + text.length + 2 > tailBudget) break;
		tail.unshift(text);
		tailChars += text.length + 2;
	}
	const omitted = entries.length - head.length - tail.length;
	const marker = `…（会话中段省略 ${omitted} 条消息，约 ${Math.max(0, total - headChars - tailChars)} 字符未展示）…`;
	const text = [
		...head,
		marker,
		...tail
	].join("\n\n");
	return {
		text,
		stats: {
			messages: messages.length,
			included: head.length + tail.length,
			chars: text.length,
			truncated: true,
			omitted
		}
	};
}
/**
* The user's own messages, in order.
*
* Injected context (skills, workspace notes, plugin notices) also rides in
* user-role messages, but it is not the human's language and must not decide
* the document language or the title. Falls back to every user-role message
* when a session has none of its own.
*/
function humanMessages(messages) {
	const own = messages.filter((message) => message.role === "user" && message.source.kind === "user");
	return own.length > 0 ? own : messages.filter((message) => message.role === "user");
}
/** First non-empty user line — a cheap title anchor, never a substitute for the task section. */
function firstUserLine(messages, maxChars = 60) {
	for (const message of humanMessages(messages)) {
		const text = contentText(message.content, false).replace(/\s+/gu, " ").trim();
		if (text !== "") return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
	}
	return "";
}
/** Heuristic for `language: auto`: CJK characters in the user's own words. */
function dominantLanguage(messages) {
	let cjk = 0;
	let latin = 0;
	for (const message of humanMessages(messages)) {
		const text = contentText(message.content, false);
		for (const char of text) if (/\p{Script=Han}/u.test(char)) cjk++;
		else if (/[A-Za-z]/u.test(char)) latin++;
	}
	return cjk >= latin / 3 && cjk > 0 ? "zh" : "en";
}
// src/generate.ts
/** Generator identity recorded in every document. */
const GENERATOR = `dsh-handoff@0.2.0`;
/** Next version number and the document it supersedes, from the output directory. */
async function nextVersion(dir) {
	const docs = await listDocuments(dir);
	const previous = docs[0];
	if (previous === void 0) return { version: 1 };
	let version = docs.length + 1;
	try {
		const parsed = parseDocumentVersion(await readDocument(dir, previous.name));
		if (parsed !== void 0) version = parsed + 1;
	} catch {}
	return {
		version,
		previous: previous.name
	};
}
/** When the session last did anything; falls back to the generation instant. */
function sessionActivity(session, fallback) {
	try {
		const events = session.snapshotEvents();
		const time = events[events.length - 1]?.time;
		if (typeof time === "number" && Number.isFinite(time)) return new Date(time);
	} catch {}
	return fallback;
}
/**
* Pick the route for the auxiliary call.
*
* An explicit `provider`/`model` pair wins. Otherwise the newest assistant
* message's own source names the route the conversation is actually using, so
* the handoff is written by the same model the user has been talking to.
*/
function resolveRoute(messages, config) {
	const provider = config.provider.trim();
	const model = config.model.trim();
	if (provider !== "" && model !== "") return {
		provider,
		model
	};
	if (provider !== "" || model !== "") throw new HandoffError("BAD_ROUTE_CONFIG", "provider 与 model 必须同时配置，或都留空以沿用会话模型。");
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		const source = message.source;
		if (source.provider !== "" && source.model !== "") return {
			provider: source.provider,
			model: source.model
		};
	}
	throw new HandoffError("NO_ROUTE", "这个会话还没有模型回复，无法推断模型；请先在插件配置里填写 provider/model。");
}
/** Collect assistant text from one stream, rejecting every non-success terminal state. */
async function streamText(stream) {
	let text = "";
	let usage;
	let finish;
	for await (const chunk of stream) switch (chunk.type) {
		case "text-delta":
			text += chunk.text;
			break;
		case "usage":
			usage = chunk.usage;
			break;
		case "finish": finish = chunk.reason;
	}
	if (finish === void 0) throw new HandoffError("NO_FINISH", "模型流没有返回结束原因。");
	switch (finish.kind) {
		case "error": throw new HandoffError(finish.failure.code, finish.failure.message);
		case "aborted": throw new HandoffError("ABORTED", "生成被取消。");
		case "tool-calls": throw new HandoffError("TOOL_CALLS", "模型选择了调用工具而不是写文档，请重试。");
	}
	return usage === void 0 ? {
		text,
		finish
	} : {
		text,
		usage,
		finish
	};
}
/**
* Generate one handoff document and write it to disk.
*
* The transcript never leaves the Host except as the summarizer request; the
* conversation itself is untouched (this is an auxiliary call, not a turn).
*/
async function generateHandoff(input) {
	const { ctx, session, config } = input;
	const messages = session.deriveMessages();
	if (messages.length === 0) throw new HandoffError("EMPTY_SESSION", "当前会话还没有任何消息。");
	const route = resolveRoute(messages, config);
	const language = config.language === "auto" ? dominantLanguage(messages) : config.language;
	const transcript = buildTranscript(messages, {
		maxChars: config.maxInputChars,
		includeToolResults: config.includeToolResults,
		includeInjectedContext: config.includeInjectedContext,
		includeReasoning: config.includeReasoning
	});
	const now = /* @__PURE__ */ new Date();
	const createdAt = localTimestamp(now);
	const cwd = session.header.cwd ?? process.cwd();
	const title = firstUserLine(messages) || (language === "zh" ? "未命名会话" : "Untitled session");
	const prompt = buildPrompt({
		language,
		cwd,
		sessionId: String(session.id),
		createdAt,
		model: `${route.provider}/${route.model}`,
		messageCount: messages.length,
		focus: input.focus,
		extraInstructions: config.extraInstructions,
		transcript: transcript.text,
		truncated: transcript.stats.truncated
	});
	const options = {
		provider: route.provider,
		model: route.model,
		system: prompt.system,
		messages: [{
			role: "user",
			content: [{
				type: "text",
				text: prompt.user
			}]
		}],
		maxTokens: config.maxOutputTokens,
		...input.signal === void 0 ? {} : { signal: input.signal }
	};
	const { text, usage } = await streamText(ctx.llm.stream(options));
	const body = normalizeBody(text);
	if (body === "") throw new HandoffError("EMPTY_DOCUMENT", "模型返回了空文档。");
	const dir = resolveOutputDir(cwd, config.outputDir);
	const chain = await nextVersion(dir);
	const activity = sessionActivity(session, now);
	const markdown = renderDocument({
		title,
		sessionId: String(session.id),
		cwd,
		createdAt,
		updatedAt: createdAt,
		version: chain.version,
		...chain.previous === void 0 ? {} : { previous: chain.previous },
		sessionActivityAt: localTimestamp(activity),
		provider: route.provider,
		model: route.model,
		messages: messages.length,
		...input.focus === "" ? {} : { focus: input.focus },
		generator: GENERATOR
	}, body);
	const fileName = documentFileName(config.filenamePrefix, now, slugify(input.focus === "" ? title : input.focus));
	const path = await writeDocument(dir, fileName, markdown);
	if (config.writeLatest) await writeDocument(dir, "latest.md", renderLatestPointer({
		name: fileName,
		version: chain.version,
		updatedAt: createdAt
	}));
	return {
		path,
		relativePath: relative(cwd, path).split("\\").join("/"),
		markdown,
		route,
		version: chain.version,
		stats: transcript.stats,
		...usage === void 0 ? {} : { usage }
	};
}
// src/routes.ts
/**
* URL prefix of this plugin's small HTTP surface.
*
* Exact routes live under the Host's `/api` channel: the Connection registry
* validates every path against it and refuses anything outside.
*/
const PREFIX = "/api/dsh-handoff";
/** JSON envelope every route answers with, matching the Host's own style. */
function ok(value) {
	return Response.json({
		ok: true,
		value
	}, { headers: { "cache-control": "no-store" } });
}
function fail(code, message) {
	return Response.json({
		ok: false,
		error: {
			code,
			message
		}
	}, { headers: { "cache-control": "no-store" } });
}
/** Read one required string field from a JSON body. */
async function bodyOf(request) {
	try {
		const value = await request.json();
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not an object");
		return value;
	} catch {
		throw new HandoffError("BAD_REQUEST", "请求体不是 JSON 对象。");
	}
}
/**
* Mount the panel's HTTP surface.
*
* Every route is an exact Host route: the request carries the browser's
* authenticated cookie, so nothing here is readable from another origin.
*/
function mountRoutes(ctx, config) {
	ctx.inject(["connection", "sessions"], (scoped) => {
		const connection = scoped.get("connection");
		if (connection === void 0) return;
		const current = connection.registerFetchRoute;
		const legacy = connection.fetch?.register;
		const sessions = scoped.sessions;
		const sessionOf = (id) => {
			if (id === "") throw new HandoffError("BAD_REQUEST", "缺少 sessionId。");
			const session = sessions.get(id);
			if (session === void 0) throw new HandoffError("NO_SESSION", `找不到会话 ${id}（只列出当前进程里活着的会话）。`);
			return session;
		};
		const outputDirOf = (session) => resolveOutputDir(session.header.cwd ?? process.cwd(), config.outputDir);
		const route = (path, methods, handler, label) => {
			const exact = {
				path: `${PREFIX}${path}`,
				methods,
				requestBody: "buffered",
				fetch: handler
			};
			if (typeof current === "function") {
				current.call(connection, scoped, exact);
				return;
			}
			if (typeof legacy === "function") scoped.effect(() => legacy.call(connection.fetch, exact), label);
		};
		route("/config", ["GET"], async () => {
			return ok({ config });
		}, "dsh-handoff: config route");
		route("/sessions", ["GET"], async () => {
			return ok({ sessions: sessions.list().map((session) => {
				try {
					const messages = session.deriveMessages();
					return {
						id: String(session.id),
						cwd: session.header.cwd ?? "",
						title: firstUserLine(messages) || String(session.id),
						messages: messages.length
					};
				} catch {
					return {
						id: String(session.id),
						cwd: session.header.cwd ?? "",
						title: String(session.id),
						messages: 0
					};
				}
			}) });
		}, "dsh-handoff: sessions route");
		route("/docs", ["GET"], async (request) => {
			try {
				const url = new URL(request.url);
				const session = sessionOf(url.searchParams.get("sessionId") ?? "");
				const dir = outputDirOf(session);
				return ok({
					dir,
					docs: await listDocuments(dir)
				});
			} catch (error) {
				return errorResponse(error);
			}
		}, "dsh-handoff: docs route");
		route("/doc", ["GET"], async (request) => {
			try {
				const url = new URL(request.url);
				const session = sessionOf(url.searchParams.get("sessionId") ?? "");
				const name = url.searchParams.get("name") ?? "";
				return ok({
					name,
					content: await readDocument(outputDirOf(session), name)
				});
			} catch (error) {
				return errorResponse(error);
			}
		}, "dsh-handoff: doc route");
		route("/generate", ["POST"], async (request) => {
			try {
				const body = await bodyOf(request);
				const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
				const focus = typeof body.focus === "string" ? body.focus.trim() : "";
				const result = await generateHandoff({
					ctx: scoped,
					session: sessionOf(sessionId),
					config,
					focus
				});
				return ok({
					path: result.relativePath,
					version: result.version,
					messages: result.stats.messages,
					chars: result.stats.chars,
					model: `${result.route.provider}/${result.route.model}`,
					truncated: result.stats.truncated
				});
			} catch (error) {
				return errorResponse(error);
			}
		}, "dsh-handoff: generate route");
	});
}
/** Map a thrown value onto the shared JSON envelope. */
function errorResponse(error) {
	if (error instanceof HandoffError) return fail(error.code, error.message);
	if (error instanceof Error) return fail("INTERNAL", error.message);
	return fail("INTERNAL", String(error));
}
// src/resume.ts
/** Injected context is bounded: a handoff is a brief, not a transcript. */
const MAX_INJECTED_CHARS = 3e4;
/**
* Load the document a new session should continue from.
*
* `latest.md` wins because it is the file the generator maintains for exactly
* this purpose; a directory that only has timestamped files falls back to the
* newest one. An explicit name is used verbatim (and must be a bare file name).
*/
async function loadHandoffForResume(session, config, requested) {
	const dir = resolveOutputDir(session.header.cwd ?? process.cwd(), config.outputDir);
	const name = await pickDocument(dir, requested);
	const raw = await readDocument(dir, name);
	const truncated = raw.length > MAX_INJECTED_CHARS;
	return {
		name,
		content: truncated ? `${raw.slice(0, MAX_INJECTED_CHARS)}\n\n…（文档超过 ${MAX_INJECTED_CHARS} 字符，以上为前半部分）…` : raw,
		truncated
	};
}
async function pickDocument(dir, requested) {
	if (requested !== "" && requested !== "latest.md") return requested;
	const latest = await latestTarget(dir);
	if (latest !== void 0) return latest;
	const newest = (await listDocuments(dir))[0];
	if (newest === void 0) throw new HandoffError("NO_DOCUMENT", `还没有交接文档（目录 ${dir}）。先运行 /handoff 生成一份。`);
	return newest.name;
}
/**
* Resolve `latest.md` to the document it names.
*
* Current builds write a pointer; older builds wrote a full copy. The copy is
* still a valid document, so it is returned as-is (`latest.md` itself), and a
* pointer that names a missing file reports the break instead of injecting the
* pointer text as if it were a handoff.
*/
async function latestTarget(dir) {
	let content;
	try {
		content = await readDocument(dir, "latest.md");
	} catch {
		return;
	}
	const target = parseLatestPointer(content);
	if (target === void 0) return "latest.md";
	try {
		await readDocument(dir, target);
	} catch {
		throw new HandoffError("BROKEN_POINTER", `latest.md 指向的 ${target} 不存在，改用 /handoff resume <文件名>。`);
	}
	return target;
}
/** Frame the document as model-facing context rather than a bare dump. */
function frameForInjection(result) {
	const tail = result.truncated ? "\n\n（文档已截断，需要时可以读取原文件补全。）" : "";
	return [
		`以下是上一个会话留下的交接文档（${result.name}）。请把它当作当前任务的已有上下文：先读它，再决定下一步。`,
		"",
		"<handoff>",
		result.content.trimEnd(),
		"</handoff>",
		tail
	].join("\n");
}
// src/index.ts
const name = "dsh-handoff";
/** The tool and the command both need the model service; commands are optional. */
const inject = ["tools", "llm"];
const TOOL_DESCRIPTION = [
	"把当前会话整理成一份交接文档（markdown），写给「下一个接手这个任务的会话」：任务是什么、已完成什么、",
	"当前进展、下一步、未完成项与风险、踩过的坑、关键文件与命令，以及一段可直接粘贴的开场白。",
	"文档写入会话工作目录下的 .dsh/handoff/（可在插件设置中改）。",
	"适用场景：用户要求交接/总结现状/收尾；或上下文即将耗尽而任务未完成，需要新会话继续。",
	"不要用它代替普通回答，也不要在用户没有要求、任务也还不需要交接时调用。"
].join("");
/** Trim a markdown body to a short tool-result preview. */
function previewOf(markdown, limit = 240) {
	const text = markdown.replace(/^---\n[\s\S]*?\n---\n/u, "").replace(/^# [^\n]*\n+/u, "").trim().replace(/\s+/gu, " ");
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
/** Build the summarizer tool bound to this plugin instance's configuration. */
function createTool(ctx, config) {
	return defineTool({
		name: "handoff",
		description: TOOL_DESCRIPTION,
		parameters: { focus: {
			type: "string",
			description: "这次交接要特别强调的点，例如「重点写测试与未修完的 bug」；可省略。"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					version: {
						type: "integer",
						required: true
					},
					messages: {
						type: "integer",
						required: true
					},
					chars: {
						type: "integer",
						required: true
					},
					model: {
						type: "string",
						required: true
					},
					truncated: {
						type: "boolean",
						required: true
					},
					preview: {
						type: "string",
						required: true
					}
				}
			},
			render(_args, value) {
				const truncated = value.truncated ? "，记录中段已省略" : "";
				return [{
					type: "text",
					text: `交接文档已写入 ${value.path}（v${value.version}，${value.messages} 条消息，${value.chars} 字符记录${truncated}，模型 ${value.model}）。\n\n预览：${value.preview}`
				}];
			}
		},
		async execute(args, exec) {
			const agent = exec.agent;
			if (agent === void 0) throw new HandoffError("NO_AGENT", "这个工具必须在一个会话里运行。");
			const result = await generateHandoff({
				ctx,
				session: agent.session,
				config,
				focus: args.focus?.trim() ?? "",
				signal: exec.signal
			});
			return {
				path: result.relativePath,
				version: result.version,
				messages: result.stats.messages,
				chars: result.stats.chars,
				model: `${result.route.provider}/${result.route.model}`,
				truncated: result.stats.truncated,
				preview: previewOf(result.markdown)
			};
		}
	});
}
/** Inject the chosen handoff document into the session as model-facing context. */
async function resumeIntoSession(invocation, requested, config) {
	try {
		const resumed = await loadHandoffForResume(invocation.agent.session, config, requested);
		const agent = invocation.agent;
		if (typeof agent.inject !== "function") return {
			kind: "error",
			text: "当前宿主不支持向会话注入上下文，无法接续。"
		};
		await agent.inject({
			content: [{
				type: "text",
				text: frameForInjection(resumed)
			}],
			source: { kind: "dsh-handoff" }
		});
		const size = resumed.content.length;
		return {
			kind: "success",
			text: `已把 ${resumed.name} 注入当前会话（${size} 字符${resumed.truncated ? "，已截断" : ""}）。模型在下一步就会读到它。`
		};
	} catch (error) {
		return {
			kind: "error",
			text: `接续失败：${describeError(error)}`
		};
	}
}
/**
* Register the handoff tool, and the `/handoff` command when the composition
* provides a command surface (the Web client does; headless runs do not).
*/
function apply(ctx, config) {
	ctx.effect(() => ctx.tools.register(createTool(ctx, config)), "dsh-handoff: handoff tool");
	mountRoutes(ctx, config);
	ctx.inject(["commands"], (commandCtx) => {
		commandCtx.effect(() => commandCtx.commands.register({
			name: "handoff",
			description: "生成或接续交接文档：/handoff [关注点] 生成，/handoff resume [文件名] 注入当前会话",
			input: { hint: "[关注点] 或 resume [文件名]" },
			async handler(invocation) {
				const raw = invocation.rawInput.trim();
				if (raw === "resume" || raw.startsWith("resume ")) return resumeIntoSession(invocation, raw.slice(6).trim(), config);
				try {
					const result = await generateHandoff({
						ctx,
						session: invocation.agent.session,
						config,
						focus: raw,
						signal: invocation.signal
					});
					const parts = [`交接文档已生成：${result.relativePath}`, `（v${result.version}，${result.stats.messages} 条消息，${result.stats.chars} 字符记录，模型 ${result.route.provider}/${result.route.model}）`];
					if (result.stats.truncated) parts.push("，会话中段因超出预算已省略");
					return {
						kind: "success",
						text: parts.join("")
					};
				} catch (error) {
					return {
						kind: "error",
						text: `交接文档生成失败：${describeError(error)}`
					};
				}
			}
		}), "dsh-handoff: /handoff command");
	});
}
export { Config, apply, inject, name };
