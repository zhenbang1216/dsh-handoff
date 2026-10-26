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
* lists generated handoff documents, previews them, and can generate a new one
* for any live session; plus a card on this bundle's configuration page.
*
* Written with `createElement` and structural service types on purpose: the
* bundle resolves `react` and the primitives through the Host's shared module
* table, so it must not depend on monorepo-internal type packages at runtime.
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
const border = "1px solid color-mix(in srgb, currentColor 16%, transparent)";
const soft = "color-mix(in srgb, currentColor 5%, transparent)";
const S = {
	page: {
		display: "flex",
		flexDirection: "column",
		height: "100%",
		minHeight: 0,
		padding: 20,
		gap: 14,
		boxSizing: "border-box"
	},
	header: {
		display: "flex",
		alignItems: "flex-end",
		justifyContent: "space-between",
		gap: 16,
		flexWrap: "wrap"
	},
	title: {
		fontSize: 18,
		fontWeight: 600
	},
	subtitle: {
		fontSize: 12,
		opacity: .65,
		marginTop: 4
	},
	actions: {
		display: "flex",
		alignItems: "center",
		gap: 8
	},
	input: {
		padding: "6px 10px",
		borderRadius: 8,
		border,
		background: "transparent",
		color: "inherit",
		fontSize: 13,
		width: 220
	},
	button: {
		padding: "7px 14px",
		borderRadius: 8,
		border,
		background: soft,
		color: "inherit",
		fontSize: 13,
		cursor: "pointer"
	},
	buttonDisabled: {
		padding: "7px 14px",
		borderRadius: 8,
		border,
		background: soft,
		color: "inherit",
		fontSize: 13,
		opacity: .5,
		cursor: "default"
	},
	toolbar: {
		display: "flex",
		alignItems: "center",
		gap: 8,
		fontSize: 12
	},
	label: { opacity: .65 },
	select: {
		padding: "5px 8px",
		borderRadius: 8,
		border,
		background: "transparent",
		color: "inherit",
		fontSize: 12,
		maxWidth: 420
	},
	note: {
		opacity: .7,
		marginLeft: 8
	},
	body: {
		display: "flex",
		gap: 16,
		flex: 1,
		minHeight: 0
	},
	list: {
		width: 300,
		flexShrink: 0,
		display: "flex",
		flexDirection: "column",
		gap: 6,
		overflowY: "auto",
		paddingRight: 4
	},
	listTitle: {
		fontSize: 12,
		opacity: .6,
		marginBottom: 2
	},
	item: {
		textAlign: "left",
		padding: "8px 10px",
		borderRadius: 8,
		border,
		background: "transparent",
		color: "inherit",
		cursor: "pointer"
	},
	itemActive: {
		textAlign: "left",
		padding: "8px 10px",
		borderRadius: 8,
		border,
		background: soft,
		color: "inherit",
		cursor: "pointer"
	},
	itemName: {
		fontSize: 12,
		wordBreak: "break-all"
	},
	badge: {
		display: "inline-block",
		marginRight: 6,
		padding: "0 5px",
		borderRadius: 4,
		border,
		fontSize: 10,
		opacity: .75,
		verticalAlign: "middle"
	},
	itemMeta: {
		fontSize: 11,
		opacity: .55,
		marginTop: 3
	},
	preview: {
		flex: 1,
		minWidth: 0,
		border,
		borderRadius: 10,
		overflow: "auto",
		padding: 14,
		background: soft
	},
	pre: {
		margin: 0,
		fontSize: 12,
		lineHeight: 1.6,
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
	},
	empty: {
		fontSize: 12,
		opacity: .55,
		padding: 8
	},
	card: {
		display: "flex",
		flexDirection: "column",
		gap: 10,
		fontSize: 12
	},
	row: {
		display: "flex",
		justifyContent: "space-between",
		gap: 12,
		padding: "4px 0",
		borderBottom: "1px solid color-mix(in srgb, currentColor 8%, transparent)"
	},
	key: { opacity: .6 },
	value: {
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
		wordBreak: "break-all",
		textAlign: "right"
	}
};
/** Sidebar row glyph. */
function Icon(props) {
	const size = props?.size ?? 16;
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
/** The sidebar page: docs list, preview, generate. */
function Page() {
	const [sessions, setSessions] = (0, react.useState)([]);
	const [sessionId, setSessionId] = (0, react.useState)("");
	const [docs, setDocs] = (0, react.useState)([]);
	const [activeName, setActiveName] = (0, react.useState)("");
	const [content, setContent] = (0, react.useState)("");
	const [focus, setFocus] = (0, react.useState)("");
	const [busy, setBusy] = (0, react.useState)(false);
	const [note, setNote] = (0, react.useState)("");
	(0, react.useEffect)(() => {
		let cancelled = false;
		call(`${API}/sessions`).then((value) => {
			if (cancelled) return;
			setSessions(value.sessions);
			const newest = value.sessions[value.sessions.length - 1];
			if (newest !== void 0) setSessionId(newest.id);
		}).catch((error) => {
			if (!cancelled) setNote(`会话列表读取失败：${String(error)}`);
		});
		return () => {
			cancelled = true;
		};
	}, []);
	const loadDocs = (0, react.useCallback)(async (id) => {
		const value = await call(`${API}/docs?sessionId=${encodeURIComponent(id)}`);
		setDocs(value.docs);
		return value.docs;
	}, []);
	(0, react.useEffect)(() => {
		if (sessionId === "") return;
		let cancelled = false;
		setActiveName("");
		setContent("");
		loadDocs(sessionId).catch((error) => {
			if (!cancelled) setNote(`文档列表读取失败：${String(error)}`);
		});
		return () => {
			cancelled = true;
		};
	}, [sessionId, loadDocs]);
	const openDoc = (0, react.useCallback)(async (documentName) => {
		setActiveName(documentName);
		setContent("");
		try {
			const value = await call(`${API}/doc?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(documentName)}`);
			setContent(value.content);
		} catch (error) {
			setContent(`读取失败：${String(error)}`);
		}
	}, [sessionId]);
	const generate = (0, react.useCallback)(async () => {
		if (sessionId === "") return;
		setBusy(true);
		setNote("");
		try {
			const value = await call(`${API}/generate`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sessionId,
					focus
				})
			});
			setNote(`已生成 ${value.path}（${value.model}）`);
			await loadDocs(sessionId);
			const created = value.path.split("/").pop();
			if (created !== void 0 && created !== "") await openDoc(created);
		} catch (error) {
			setNote(`生成失败：${String(error)}`);
		} finally {
			setBusy(false);
		}
	}, [
		sessionId,
		focus,
		loadDocs,
		openDoc
	]);
	const onSession = (event) => {
		setSessionId(event.target.value);
	};
	return (0, react.createElement)("div", { style: S.page }, (0, react.createElement)("div", { style: S.header }, (0, react.createElement)("div", null, (0, react.createElement)("div", { style: S.title }, "交接文档"), (0, react.createElement)("div", { style: S.subtitle }, "把当前会话写成下一个会话能直接接手的 markdown。")), (0, react.createElement)("div", { style: S.actions }, (0, react.createElement)("input", {
		style: S.input,
		placeholder: "关注点（可省略）",
		value: focus,
		onChange: (event) => setFocus(event.target.value)
	}), (0, react.createElement)("button", {
		style: busy ? S.buttonDisabled : S.button,
		disabled: busy || sessionId === "",
		onClick: () => void generate()
	}, busy ? "生成中…" : "生成交接文档"))), (0, react.createElement)("div", { style: S.toolbar }, (0, react.createElement)("span", { style: S.label }, "会话"), (0, react.createElement)("select", {
		style: S.select,
		value: sessionId,
		onChange: onSession
	}, sessions.length === 0 ? (0, react.createElement)("option", { value: "" }, "没有活动会话") : sessions.map((session) => (0, react.createElement)("option", {
		key: session.id,
		value: session.id
	}, `${session.title}（${session.messages} 条）`))), note === "" ? null : (0, react.createElement)("span", { style: S.note }, note)), (0, react.createElement)("div", { style: S.body }, (0, react.createElement)("div", { style: S.list }, (0, react.createElement)("div", { style: S.listTitle }, `历史文档（${docs.length}）`), docs.length === 0 ? (0, react.createElement)("div", { style: S.empty }, "还没有文档。点右上角生成第一份。") : docs.map((doc, index) => (0, react.createElement)("button", {
		key: doc.name,
		style: doc.name === activeName ? S.itemActive : S.item,
		title: doc.name,
		onClick: () => void openDoc(doc.name)
	}, (0, react.createElement)("div", { style: S.itemName }, index === 0 ? (0, react.createElement)("span", { style: S.badge }, "最新") : null, doc.name), (0, react.createElement)("div", { style: S.itemMeta }, `${new Date(doc.modifiedAt).toLocaleString()} · ${Math.max(1, Math.round(doc.size / 1024))} KB`)))), (0, react.createElement)("div", { style: S.preview }, content === "" ? (0, react.createElement)("div", { style: S.empty }, activeName === "" ? "选一份文档预览。" : "读取中…") : (0, react.createElement)("pre", { style: S.pre }, content))));
}
/** The configuration card on this bundle's page. */
function SettingsCard(props) {
	const view = props?.view;
	const [config, setConfig] = (0, react.useState)(null);
	const [note, setNote] = (0, react.useState)("");
	(0, react.useEffect)(() => {
		let cancelled = false;
		call(`${API}/config`).then((value) => {
			if (!cancelled) setConfig(value.config);
		}).catch((error) => {
			if (!cancelled) setNote(`读取配置失败：${String(error)}`);
		});
		return () => {
			cancelled = true;
		};
	}, []);
	if (view === "summary") return (0, react.createElement)("div", null, "把当前会话整理成交接文档，写给下一个会话。");
	const rows = config === null ? [] : Object.entries(config).map(([key, value]) => (0, react.createElement)("div", {
		style: S.row,
		key
	}, (0, react.createElement)("span", { style: S.key }, key), (0, react.createElement)("span", { style: S.value }, String(value))));
	return (0, react.createElement)("div", { style: S.card }, (0, react.createElement)("div", null, "这些值来自 profile 里的插件配置（cordis.patch.yml 的 dsh-handoff 条目）。改完后重新加载插件或重启 Harness 生效；下面的值是当前这次运行实际使用的。"), note === "" ? null : (0, react.createElement)("div", { style: S.empty }, note), ...rows);
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
exports.name = name;


return module.exports;
}
});
