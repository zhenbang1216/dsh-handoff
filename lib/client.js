window.__ModuleLoader__.load({ id: "dsh-handoff", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;

Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
// src/client/index.ts
/**
* Browser half of dsh-handoff.
*
* Registers one sidebar page (a `main` panel beside the Host's own pages) that
* lists generated handoff documents, previews them as rendered markdown, and
* can generate a new one for any live session; plus a card on this bundle's
* configuration page.
*
* Written with `createElement` and structural service types on purpose: the
* bundle resolves `react` and the primitives through the Host's shared module
* table, so it must not depend on monorepo-internal type packages at runtime.
* Styling ships as one class sheet in a `<style>` tag — plain inline styles
* cannot express hover/focus states or theme-safe `color-mix` surfaces.
*/
const NS = "dsh-handoff";
const API = "/api/dsh-handoff";
const name = "dsh-handoff";
const inject = ["slots"];
/** Call one plugin route and unwrap its envelope. */
async function call(path, init) {
	const response = await fetch(path, {
		cache: "no-store",
		...init
	});
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error(`HTTP ${response.status}`);
	}
	if (body.ok !== true) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
	return body.value;
}
/**
* The class sheet. Neutral surfaces mix `currentColor` per rule (never through
* a custom property), so the page adapts to the Host's light/dark theme; the
* accent is the one fixed color.
*/
const CSS = `
.dh-page{display:flex;flex-direction:column;height:100%;min-height:0;padding:16px 20px 14px;gap:12px;box-sizing:border-box;font-size:13px;--dh-accent:#3e7bfa;--dh-accent-soft:color-mix(in srgb,#3e7bfa 9%,transparent)}
.dh-page *{box-sizing:border-box}
.dh-header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.dh-titlewrap{display:flex;align-items:center;gap:10px;min-width:0}
.dh-titleicon{display:flex;flex-shrink:0;color:var(--dh-accent)}
.dh-title{font-size:17px;font-weight:650;line-height:1.2}
.dh-subtitle{font-size:12px;opacity:.6;margin-top:2px}
.dh-actions{display:flex;align-items:center;gap:8px}
.dh-input{width:240px;padding:7px 11px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);background:transparent;color:inherit;font-size:13px;outline:none;transition:border-color .15s}
.dh-input:focus{border-color:color-mix(in srgb,var(--dh-accent) 70%,transparent)}
.dh-input::placeholder{opacity:.45}
.dh-btn{display:inline-flex;align-items:center;gap:7px;padding:7px 16px;border-radius:8px;border:none;background:var(--dh-accent);color:#fff;font-size:13px;font-weight:550;cursor:pointer;transition:filter .15s,opacity .15s}
.dh-btn:hover{filter:brightness(1.08)}
.dh-btn:disabled{opacity:.55;cursor:default;filter:none}
.dh-toolbar{display:flex;align-items:center;gap:8px;min-height:28px}
.dh-label{opacity:.6;font-size:12px;flex-shrink:0}
.dh-select{flex:0 1 480px;min-width:180px;max-width:520px;padding:6px 10px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);background:transparent;color:inherit;font-size:12px;outline:none;text-overflow:ellipsis}
.dh-note{font-size:12px;padding:3px 10px;border-radius:99px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:440px}
.dh-note-ok{background:color-mix(in srgb,#2f9e5f 13%,transparent);color:color-mix(in srgb,#2f9e5f 78%,currentColor)}
.dh-note-err{background:color-mix(in srgb,#d65050 13%,transparent);color:color-mix(in srgb,#d65050 82%,currentColor)}
.dh-body{display:flex;gap:14px;flex:1;min-height:0}
.dh-side{width:320px;flex-shrink:0;display:flex;flex-direction:column;min-height:0;gap:8px}
.dh-sidehead{display:flex;align-items:center;justify-content:space-between;font-size:12px;opacity:.8;padding-right:2px}
.dh-iconbtn{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);background:transparent;color:inherit;opacity:.65;cursor:pointer;transition:opacity .15s,background .15s}
.dh-iconbtn:hover{opacity:1;background:color-mix(in srgb,currentColor 6%,transparent)}
.dh-docs{overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:2px 4px 8px 2px}
.dh-doc{text-align:left;padding:9px 11px;border-radius:10px;border:1px solid color-mix(in srgb,currentColor 13%,transparent);background:transparent;color:inherit;cursor:pointer;transition:background .15s,border-color .15s}
.dh-doc:hover{background:color-mix(in srgb,currentColor 5%,transparent)}
.dh-doc-active,.dh-doc-active:hover{border-color:color-mix(in srgb,var(--dh-accent) 55%,transparent);background:var(--dh-accent-soft)}
.dh-docname{font-size:12.5px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dh-pill{display:inline-block;margin-right:6px;padding:1px 7px;border-radius:99px;background:color-mix(in srgb,var(--dh-accent) 16%,transparent);color:color-mix(in srgb,var(--dh-accent) 85%,currentColor);font-size:10px;font-weight:600;vertical-align:1px}
.dh-docmeta{font-size:11px;opacity:.55;margin-top:3px;display:flex;gap:8px}
.dh-main{flex:1;min-width:0;display:flex;flex-direction:column;border:1px solid color-mix(in srgb,currentColor 13%,transparent);border-radius:12px;overflow:hidden;background:color-mix(in srgb,currentColor 3%,transparent)}
.dh-mainhead{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent);flex-shrink:0}
.dh-mainname{flex:1;font-size:12px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dh-chip{padding:3px 10px;border-radius:99px;border:1px solid color-mix(in srgb,currentColor 15%,transparent);background:transparent;color:inherit;font-size:11px;cursor:pointer;transition:background .15s;flex-shrink:0}
.dh-chip:hover{background:color-mix(in srgb,currentColor 6%,transparent)}
.dh-preview{flex:1;overflow:auto;padding:18px 24px 32px}
.dh-md{font-size:13px;line-height:1.8;max-width:860px}
.dh-md h1{font-size:18px;font-weight:650;margin:0 0 6px;padding-bottom:8px;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent)}
.dh-md h2{font-size:15px;font-weight:640;margin:18px 0 6px;padding-bottom:4px;border-bottom:1px solid color-mix(in srgb,currentColor 8%,transparent)}
.dh-md h3{font-size:13.5px;font-weight:640;margin:14px 0 4px}
.dh-md h4,.dh-md h5{font-size:13px;font-weight:640;margin:12px 0 4px}
.dh-md p{margin:8px 0}
.dh-md ul,.dh-md ol{margin:8px 0;padding-left:1.5em}
.dh-md li{margin:3px 0}
.dh-md code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:color-mix(in srgb,currentColor 8%,transparent);padding:1px 5px;border-radius:4px;word-break:break-word}
.dh-md pre{margin:10px 0;padding:10px 14px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 12%,transparent);background:color-mix(in srgb,currentColor 5%,transparent);overflow:auto}
.dh-md pre code{background:transparent;padding:0;font-size:12px;line-height:1.6;white-space:pre}
.dh-md blockquote{margin:10px 0;padding:2px 12px;border-left:3px solid color-mix(in srgb,var(--dh-accent) 60%,transparent);opacity:.75}
.dh-md hr{border:none;border-top:1px solid color-mix(in srgb,currentColor 12%,transparent);margin:16px 0}
.dh-md a{color:var(--dh-accent);text-decoration:none}
.dh-md a:hover{text-decoration:underline}
.dh-md strong{font-weight:650}
.dh-details{margin:0 0 14px;font-size:11.5px;opacity:.8}
.dh-details summary{cursor:pointer;user-select:none;opacity:.75}
.dh-cfggrid{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;margin:7px 0 0}
.dh-cfgkey{opacity:.6;white-space:nowrap}
.dh-cfgval{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}
.dh-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:.45;font-size:12px}
.dh-empty-small{padding:14px 6px;font-size:12px;opacity:.5;line-height:1.6}
.dh-spin{display:inline-block;width:12px;height:12px;border:2px solid color-mix(in srgb,currentColor 25%,transparent);border-top-color:var(--dh-accent);border-radius:50%;animation:dh-rotate .8s linear infinite}
.dh-btn .dh-spin{border-color:rgba(255,255,255,.35);border-top-color:#fff}
@keyframes dh-rotate{to{transform:rotate(360deg)}}
.dh-card{display:flex;flex-direction:column;gap:10px;font-size:12px;max-width:660px}
.dh-cardnote{opacity:.65;line-height:1.7}
.dh-cardsummary{font-size:12px;opacity:.8}
.dh-cfgrow{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid color-mix(in srgb,currentColor 8%,transparent)}
.dh-cfgrow .dh-cfgkey{flex-shrink:0}
.dh-cfgrow .dh-cfgval{text-align:right}
`;
/** Document glyph used inside the page, with concrete props for `createElement`. */
function DocGlyph({ size }) {
	return (0, react.createElement)("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.4,
		strokeLinecap: "round",
		strokeLinejoin: "round"
	}, (0, react.createElement)("path", { d: "M3 2.5h6.5L13 6v7.5H3z" }), (0, react.createElement)("path", { d: "M9 2.5V6h4" }), (0, react.createElement)("path", { d: "M5.5 9h5M5.5 11.5h3" }));
}
/** Sidebar row glyph: the slot contract passes untyped owner props. */
function Icon(props) {
	return DocGlyph({ size: props?.size ?? 16 });
}
/** Small circular-arrow glyph for the list refresh button. */
function RefreshIcon() {
	return (0, react.createElement)("svg", {
		width: 13,
		height: 13,
		viewBox: "0 0 16 16",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.5,
		strokeLinecap: "round",
		strokeLinejoin: "round"
	}, (0, react.createElement)("path", { d: "M13.5 8a5.5 5.5 0 1 1-1.61-3.89" }), (0, react.createElement)("path", { d: "M13.5 2.5v3h-3" }));
}
/**
* Copy text without assuming a secure-context clipboard. The hidden-textarea
* fallback keeps the button working in plain-http dev setups.
*/
async function copyToClipboard(text) {
	if (navigator.clipboard !== void 0) try {
		await navigator.clipboard.writeText(text);
		return;
	} catch {}
	const area = document.createElement("textarea");
	area.value = text;
	area.style.position = "fixed";
	area.style.opacity = "0";
	document.body.appendChild(area);
	area.select();
	try {
		document.execCommand("copy");
	} finally {
		area.remove();
	}
}
const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/gu;
/** Render inline markdown: `` `code` ``, `**bold**`, `[text](url)`. */
function inlineChildren(text, keyBase) {
	const out = [];
	let last = 0;
	let index = 0;
	for (const match of text.matchAll(INLINE_RE)) {
		const token = match[0] ?? "";
		const start = match.index ?? 0;
		if (start > last) out.push(text.slice(last, start));
		const key = `${keyBase}#${index}`;
		index += 1;
		if (token.startsWith("`")) out.push((0, react.createElement)("code", { key }, token.slice(1, -1)));
		else if (token.startsWith("**")) out.push((0, react.createElement)("strong", { key }, token.slice(2, -2)));
		else {
			const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/u.exec(token);
			if (link === null) out.push(token);
			else out.push((0, react.createElement)("a", {
				key,
				href: link[2],
				target: "_blank",
				rel: "noreferrer"
			}, link[1]));
		}
		last = start + token.length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}
const LIST_RE = /^([-*+]|\d+[.)])\s+(.*)$/u;
const RULE_RE = /^(-{3,}|\*{3,}|_{3,})$/u;
/**
* Render the markdown the model writes — headings, fenced code, quotes,
* lists, rules, paragraphs — as elements. Deliberately small: the prompt
* contract fixes the section shape, so this covers what documents contain
* plus the common extras, and falls back to plain paragraphs elsewhere.
*
* Exported for the regression tests: every branch here must advance the line
* cursor, or previewing one document pins the renderer thread.
*/
function markdownBody(src) {
	const lines = src.split("\n");
	const out = [];
	let at = 0;
	let key = 0;
	while (at < lines.length) {
		const trimmed = (lines[at] ?? "").trim();
		if (trimmed === "") {
			at += 1;
			continue;
		}
		if (trimmed.startsWith("```")) {
			const buf = [];
			at += 1;
			while (at < lines.length && !(lines[at] ?? "").trim().startsWith("```")) {
				buf.push(lines[at] ?? "");
				at += 1;
			}
			at += 1;
			out.push((0, react.createElement)("pre", { key: key++ }, (0, react.createElement)("code", null, buf.join("\n"))));
			continue;
		}
		const heading = /^(#{1,6})\s+(.*)$/u.exec(trimmed);
		if (heading !== null) {
			const tag = `h${Math.min(heading[1]?.length ?? 1, 5)}`;
			out.push((0, react.createElement)(tag, { key: key++ }, inlineChildren(heading[2] ?? "", `h${key}`)));
			at += 1;
			continue;
		}
		if (RULE_RE.test(trimmed)) {
			out.push((0, react.createElement)("hr", { key: key++ }));
			at += 1;
			continue;
		}
		if (trimmed.startsWith(">")) {
			const buf = [];
			while (at < lines.length) {
				const current = (lines[at] ?? "").trim();
				if (!current.startsWith(">")) break;
				buf.push(current.replace(/^>\s?/u, ""));
				at += 1;
			}
			out.push((0, react.createElement)("blockquote", { key: key++ }, inlineChildren(buf.join(" "), `q${key}`)));
			continue;
		}
		const first = LIST_RE.exec(trimmed);
		if (first !== null) {
			const ordered = /\d/u.test(first[1] ?? "");
			const items = [];
			while (at < lines.length) {
				const raw = lines[at] ?? "";
				const current = raw.trim();
				const item = LIST_RE.exec(current);
				if (item !== null && /\d/u.test(item[1] ?? "") === ordered) {
					items.push(item[2] ?? "");
					at += 1;
					continue;
				}
				if (items.length > 0 && current !== "" && /^\s/u.test(raw)) {
					items[items.length - 1] = `${items[items.length - 1] ?? ""} ${current}`;
					at += 1;
					continue;
				}
				break;
			}
			const children = items.map((text, index) => (0, react.createElement)("li", { key: index }, inlineChildren(text, `li${key}-${index}`)));
			out.push((0, react.createElement)(ordered ? "ol" : "ul", { key: key++ }, children));
			continue;
		}
		const para = [];
		while (at < lines.length) {
			const current = (lines[at] ?? "").trim();
			if (current === "" || current.startsWith("```") || current.startsWith(">") || RULE_RE.test(current) || LIST_RE.test(current) || /^#{1,6}\s/u.test(current)) break;
			para.push(current);
			at += 1;
		}
		if (para.length > 0) out.push((0, react.createElement)("p", { key: key++ }, inlineChildren(para.join("\n"), `p${key}`)));
		else at += 1;
	}
	return out;
}
const FRONT_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/u;
/** Split YAML front matter off the raw document for the collapsible info block. */
function splitFrontMatter(content) {
	const match = FRONT_RE.exec(content);
	if (match === null) return {
		fields: [],
		body: content
	};
	const fields = [];
	for (const line of (match[1] ?? "").split("\n")) {
		const at = line.indexOf(":");
		if (at <= 0) continue;
		fields.push([line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"+|"+$/gu, "")]);
	}
	return {
		fields,
		body: content.slice(match[0].length)
	};
}
const DOC_NAME_RE = /^(.*?)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)\.md$/u;
/**
* `handoff-20261026-085833-补测试.md` reads better as 「补测试 · 10-26 08:58」.
* Falls back to the bare name for anything that does not match the layout.
*/
function friendlyDocName(name) {
	const match = DOC_NAME_RE.exec(name);
	if (match === null) return {
		title: name.replace(/\.md$/u, ""),
		when: ""
	};
	const slug = (match[8] ?? "").trim();
	const month = match[3] ?? "";
	const day = match[4] ?? "";
	const hour = match[5] ?? "";
	const minute = match[6] ?? "";
	return {
		title: slug === "" ? name : slug,
		when: `${month}-${day} ${hour}:${minute}`
	};
}
/** Pull out the paste-ready opening message (zh or en section) for its own copy button. */
function extractOpeningMessage(content) {
	const lines = content.split("\n");
	const buffer = [];
	let capturing = false;
	for (const line of lines) {
		if (/^#{1,6}\s/u.test(line.trim())) {
			if (capturing) break;
			capturing = /开场白|opening message/iu.test(line);
			continue;
		}
		if (capturing && line.trim() !== "") buffer.push(line.trim());
	}
	const text = buffer.join("\n").trim();
	return text === "" ? void 0 : text;
}
function twoPartTime(ms) {
	const date = new Date(ms);
	const pad = (value) => String(value).padStart(2, "0");
	return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** The sidebar page: docs list, preview, generate. */
function Page() {
	const [sessions, setSessions] = (0, react.useState)([]);
	const [sessionId, setSessionId] = (0, react.useState)("");
	const [docs, setDocs] = (0, react.useState)([]);
	const [latest, setLatest] = (0, react.useState)(void 0);
	const [activeName, setActiveName] = (0, react.useState)("");
	const [content, setContent] = (0, react.useState)("");
	const [contentLoading, setContentLoading] = (0, react.useState)(false);
	const [listLoading, setListLoading] = (0, react.useState)(false);
	const [focus, setFocus] = (0, react.useState)("");
	const [busy, setBusy] = (0, react.useState)(false);
	const [note, setNote] = (0, react.useState)("");
	const [noteIsError, setNoteIsError] = (0, react.useState)(false);
	const say = (0, react.useCallback)((text, isError) => {
		setNote(text);
		setNoteIsError(isError);
	}, []);
	(0, react.useEffect)(() => {
		let cancelled = false;
		call(`${API}/sessions`).then((value) => {
			if (cancelled) return;
			setSessions(value.sessions);
			const newest = value.sessions[value.sessions.length - 1];
			if (newest !== void 0) setSessionId(newest.id);
		}).catch((error) => {
			if (!cancelled) say(`会话列表读取失败：${String(error)}`, true);
		});
		return () => {
			cancelled = true;
		};
	}, [say]);
	const loadDocs = (0, react.useCallback)(async (id) => {
		setListLoading(true);
		try {
			const value = await call(`${API}/docs?sessionId=${encodeURIComponent(id)}`);
			const list = value.docs ?? [];
			setDocs(list);
			setLatest(value.latest);
			return list;
		} finally {
			setListLoading(false);
		}
	}, []);
	(0, react.useEffect)(() => {
		if (sessionId === "") return;
		let cancelled = false;
		setActiveName("");
		setContent("");
		setNote("");
		loadDocs(sessionId).catch((error) => {
			if (!cancelled) say(`文档列表读取失败：${String(error)}`, true);
		});
		return () => {
			cancelled = true;
		};
	}, [
		sessionId,
		loadDocs,
		say
	]);
	const openDoc = (0, react.useCallback)(async (documentName) => {
		setActiveName(documentName);
		setContent("");
		setContentLoading(true);
		try {
			const value = await call(`${API}/doc?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(documentName)}`);
			setContent(value.content);
		} catch (error) {
			say(`读取失败：${String(error)}`, true);
		} finally {
			setContentLoading(false);
		}
	}, [sessionId, say]);
	const refreshDocs = (0, react.useCallback)(() => {
		if (sessionId === "") return;
		loadDocs(sessionId).catch((error) => say(`文档列表读取失败：${String(error)}`, true));
	}, [
		sessionId,
		loadDocs,
		say
	]);
	const generate = (0, react.useCallback)(async () => {
		if (sessionId === "") return;
		setBusy(true);
		say("正在生成交接文档…", false);
		try {
			const value = await call(`${API}/generate`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sessionId,
					focus
				})
			});
			const created = value.path.split("/").pop() ?? "";
			say(`已生成 ${created}（${value.model}）`, false);
			await loadDocs(sessionId);
			if (created !== "") await openDoc(created);
		} catch (error) {
			say(`生成失败：${String(error)}`, true);
		} finally {
			setBusy(false);
		}
	}, [
		sessionId,
		focus,
		loadDocs,
		openDoc,
		say
	]);
	const copy = (0, react.useCallback)((text, label) => {
		copyToClipboard(text).then(() => say(`已复制${label}到剪贴板`, false)).catch((error) => say(`复制失败：${String(error)}`, true));
	}, [say]);
	const onSession = (event) => {
		setSessionId(event.target.value);
	};
	const latestName = latest !== void 0 && docs.some((doc) => doc.name === latest) ? latest : docs[0]?.name;
	const parsed = splitFrontMatter(content);
	const opening = activeName === "" ? void 0 : extractOpeningMessage(content);
	return (0, react.createElement)("div", { className: "dh-page" }, (0, react.createElement)("style", { key: "dh-css" }, CSS), (0, react.createElement)("div", { className: "dh-header" }, (0, react.createElement)("div", { className: "dh-titlewrap" }, (0, react.createElement)("span", { className: "dh-titleicon" }, (0, react.createElement)(DocGlyph, { size: 20 })), (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "dh-title" }, "交接文档"), (0, react.createElement)("div", { className: "dh-subtitle" }, "把当前会话写成下一个会话能直接接手的 markdown。"))), (0, react.createElement)("div", { className: "dh-actions" }, (0, react.createElement)("input", {
		className: "dh-input",
		"aria-label": "关注点",
		placeholder: "关注点（可省略）",
		value: focus,
		onChange: (event) => setFocus(event.target.value)
	}), (0, react.createElement)("button", {
		className: "dh-btn",
		disabled: busy || sessionId === "",
		onClick: () => void generate()
	}, busy ? (0, react.createElement)("span", {
		className: "dh-spin",
		key: "spin"
	}) : null, busy ? "生成中…" : "生成交接文档"))), (0, react.createElement)("div", { className: "dh-toolbar" }, (0, react.createElement)("span", { className: "dh-label" }, "会话"), (0, react.createElement)("select", {
		className: "dh-select",
		"aria-label": "选择会话",
		value: sessionId,
		onChange: onSession
	}, sessions.length === 0 ? (0, react.createElement)("option", { value: "" }, "没有活动会话") : sessions.map((session) => (0, react.createElement)("option", {
		key: session.id,
		value: session.id
	}, `${session.title}（${session.messages} 条）`))), note === "" ? null : (0, react.createElement)("span", {
		className: `dh-note ${noteIsError ? "dh-note-err" : "dh-note-ok"}`,
		title: note
	}, note)), (0, react.createElement)("div", { className: "dh-body" }, (0, react.createElement)("div", { className: "dh-side" }, (0, react.createElement)("div", { className: "dh-sidehead" }, (0, react.createElement)("span", null, `历史文档（${docs.length}）`), (0, react.createElement)("button", {
		className: "dh-iconbtn",
		title: "刷新列表",
		"aria-label": "刷新列表",
		onClick: refreshDocs,
		disabled: sessionId === ""
	}, (0, react.createElement)(RefreshIcon))), (0, react.createElement)("div", { className: "dh-docs" }, docs.length === 0 ? (0, react.createElement)("div", { className: "dh-empty-small" }, listLoading ? "读取中…" : "还没有文档。点右上角生成第一份。") : docs.map((doc) => {
		const info = friendlyDocName(doc.name);
		const active = doc.name === activeName;
		return (0, react.createElement)("button", {
			key: doc.name,
			className: active ? "dh-doc dh-doc-active" : "dh-doc",
			title: doc.name,
			onClick: () => void openDoc(doc.name)
		}, (0, react.createElement)("div", { className: "dh-docname" }, doc.name === latestName ? (0, react.createElement)("span", { className: "dh-pill" }, "最新") : null, info.title), (0, react.createElement)("div", { className: "dh-docmeta" }, (0, react.createElement)("span", null, info.when === "" ? twoPartTime(doc.modifiedAt) : info.when), (0, react.createElement)("span", null, `${Math.max(1, Math.round(doc.size / 1024))} KB`)));
	}))), (0, react.createElement)("div", { className: "dh-main" }, (0, react.createElement)("div", { className: "dh-mainhead" }, (0, react.createElement)("span", { className: "dh-mainname" }, activeName === "" ? "预览" : activeName), content === "" ? null : (0, react.createElement)("button", {
		className: "dh-chip",
		onClick: () => copy(content, "全文")
	}, "复制全文"), opening === void 0 ? null : (0, react.createElement)("button", {
		className: "dh-chip",
		onClick: () => copy(opening, "开场白")
	}, "复制开场白")), content === "" ? (0, react.createElement)("div", { className: "dh-empty" }, contentLoading ? (0, react.createElement)("span", { className: "dh-spin" }) : (0, react.createElement)(DocGlyph, { size: 28 }), (0, react.createElement)("span", null, activeName === "" ? "选一份文档预览" : "读取中…")) : (0, react.createElement)("div", { className: "dh-preview" }, parsed.fields.length > 0 ? (0, react.createElement)("details", { className: "dh-details" }, (0, react.createElement)("summary", null, `文档信息（v${parsed.fields.find(([key]) => key === "version")?.[1] ?? "?"}）`), (0, react.createElement)("div", { className: "dh-cfggrid" }, parsed.fields.map(([key, value]) => [(0, react.createElement)("span", {
		className: "dh-cfgkey",
		key: `${key}k`
	}, key), (0, react.createElement)("span", {
		className: "dh-cfgval",
		key: `${key}v`
	}, value)]))) : null, (0, react.createElement)("div", { className: "dh-md" }, markdownBody(parsed.body))))));
}
/** The configuration card on this bundle's page. */
function SettingsCard(props) {
	const view = props?.view;
	const [config, setConfig] = (0, react.useState)(null);
	const [error, setError] = (0, react.useState)("");
	(0, react.useEffect)(() => {
		let cancelled = false;
		call(`${API}/config`).then((value) => {
			if (!cancelled) setConfig(value.config);
		}).catch((cause) => {
			if (!cancelled) setError(`读取配置失败：${String(cause)}`);
		});
		return () => {
			cancelled = true;
		};
	}, []);
	if (view === "summary") return (0, react.createElement)("div", { className: "dh-cardsummary" }, "把当前会话整理成交接文档，写给下一个会话。");
	const rows = config === null ? [] : Object.entries(config).map(([key, value]) => (0, react.createElement)("div", {
		className: "dh-cfgrow",
		key
	}, (0, react.createElement)("span", { className: "dh-cfgkey" }, key), (0, react.createElement)("span", { className: "dh-cfgval" }, String(value))));
	return (0, react.createElement)("div", { className: "dh-card" }, (0, react.createElement)("style", { key: "dh-css" }, CSS), (0, react.createElement)("div", { className: "dh-cardnote" }, "这些值来自 profile 里的插件配置（cordis.patch.yml 的 dsh-handoff 条目）。改完后重新加载插件或重启 Harness 生效；下面的值是当前这次运行实际使用的。"), error === "" ? null : (0, react.createElement)("div", { className: "dh-note dh-note-err" }, error), config === null && error === "" ? (0, react.createElement)("div", { className: "dh-cardnote" }, "读取中…") : null, ...rows);
}
/** Register the page, its sidebar row, and the bundle's configuration card. */
function apply(ctx) {
	const noProps = () => ({});
	ctx.slots.inject("sidebar.panellist", () => {
		ctx.slots.register({
			name: "main",
			key: NS,
			inject: noProps
		}, Page);
		ctx.slots.register({
			name: "sidebar.panellist",
			id: NS,
			order: 30,
			label: () => "交接文档",
			inject: noProps
		}, Icon);
	});
	ctx.slots.inject("plugins.bundle.config", () => {
		ctx.slots.register({
			name: "plugins.bundle.config",
			key: NS,
			inject: noProps
		}, SettingsCard);
	});
}
exports.apply = apply;
exports.inject = inject;
exports.markdownBody = markdownBody;
exports.name = name;


return module.exports;
}
});
