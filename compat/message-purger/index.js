(function(exports, plugin, metro, common, patcher, assets, toasts, utils, _vendetta, ui, storage) {
    const { React, ReactNative: RN } = common;
    const { View, Text, TextInput, TouchableOpacity, ScrollView } = RN;
    const { showConfirmationAlert } = ui.alerts;
    const { showToast } = ui.toasts;
    const INITIAL_DELETE_DELAY_MS = 800;
    const MIN_DELETE_DELAY_MS = 450;
    const MAX_DELETE_DELAY_MS = 8000;
    const DELAY_STEP_MS = 50;
    const SUCCESS_STREAK_FOR_SPEEDUP = 5;
    const RATE_LIMIT_MARGIN_MS = 250;
    const listeners = new Set();
    let state;
    let activeCancel;

    const notify = () => listeners.forEach(listener => listener());
    const subscribe = listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };
    const getState = () => state;
    const update = patch => {
        if (!state) return;
        state = { ...state, ...patch };
        notify();
    };
    const sleepWhileActive = (ms, cancelled) => new Promise(resolve => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (cancelled()) {
                clearInterval(timer);
                resolve(false);
            } else if (Date.now() - startedAt >= ms) {
                clearInterval(timer);
                resolve(true);
            }
        }, Math.min(100, Math.max(1, ms)));
    });
    const parseDate = value => {
        if (!value.trim()) return undefined;
        const date = new Date(`${value.trim()}T00:00:00`);
        return Number.isNaN(date.getTime()) ? undefined : date;
    };

    function startPurge(channelId, afterDate, beforeDate) {
        if (state?.running) return undefined;
        let cancelled = false;
        state = { running: true, status: "Starting...", scanned: 0, found: 0, deleted: 0, failed: 0, cancelled: false, done: false, channelId, startedAt: Date.now(), delayMs: INITIAL_DELETE_DELAY_MS };
        activeCancel = () => { cancelled = true; };
        notify();
        (async () => {
            const UserStore = metro.findByStoreName?.("UserStore");
            const RestAPI = metro.findByProps?.("getAPIBaseURL", "get", "del");
            const selfId = UserStore?.getCurrentUser?.()?.id;
            if (!selfId) return update({ running: false, done: true, status: "Could not determine current user. Aborting." });
            if (!RestAPI?.get || !RestAPI?.del) return update({ running: false, done: true, status: "Could not find Discord's REST module. Aborting." });
            const ids = [];
            let before;
            update({ status: "Scanning message history..." });
            try {
                while (!cancelled) {
                    const response = await RestAPI.get({ url: `/channels/${channelId}/messages`, query: { limit: 100, ...(before ? { before } : {}) } });
                    const page = response?.body ?? [];
                    if (!Array.isArray(page) || !page.length) break;
                    for (const message of page) {
                        state.scanned++;
                        if (message.author?.id !== selfId) continue;
                        const date = new Date(message.timestamp);
                        if (afterDate && date < afterDate) continue;
                        if (beforeDate && date > beforeDate) continue;
                        ids.push(message.id);
                        state.found++;
                    }
                    notify();
                    before = page[page.length - 1]?.id;
                    if (page.length < 100 || !(await sleepWhileActive(300, () => cancelled))) break;
                }
                if (cancelled) return update({ running: false, done: true, cancelled: true, status: "Cancelled during scan." });
                update({ status: `Deleting ${ids.length} message(s)...` });
                let delayMs = INITIAL_DELETE_DELAY_MS;
                let successfulSinceRateLimit = 0;
                for (const id of ids) {
                    if (cancelled) break;
                    let retries = 3;
                    let deleted = false;
                    while (retries-- > 0) {
                        try {
                            await RestAPI.del({ url: `/channels/${channelId}/messages/${id}` });
                            state.deleted++;
                            successfulSinceRateLimit++;
                            deleted = true;
                            break;
                        } catch (error) {
                            const retryAfter = error?.body?.retry_after ?? error?.retry_after;
                            if (retryAfter === undefined) {
                                state.failed++;
                                break;
                            }
                            update({ status: `Rate limited, waiting ${retryAfter}s...` });
                            if (!(await sleepWhileActive(Number(retryAfter) * 1000 + RATE_LIMIT_MARGIN_MS, () => cancelled))) break;
                            delayMs = Math.min(MAX_DELETE_DELAY_MS, Math.max(delayMs * 2, Number(retryAfter) * 1000 + RATE_LIMIT_MARGIN_MS));
                            successfulSinceRateLimit = 0;
                            update({ delayMs });
                        }
                    }
                    if (cancelled) break;
                    if (deleted && successfulSinceRateLimit >= SUCCESS_STREAK_FOR_SPEEDUP) {
                        delayMs = Math.max(MIN_DELETE_DELAY_MS, delayMs - DELAY_STEP_MS);
                        successfulSinceRateLimit = 0;
                        update({ delayMs });
                    }
                    update({ status: `Deleted ${state.deleted}/${ids.length}` });
                    if (!(await sleepWhileActive(delayMs, () => cancelled))) break;
                }
                update({ running: false, done: true, cancelled, status: cancelled ? `Cancelled. Deleted ${state.deleted} before stopping.` : `Done. Deleted ${state.deleted}, failed ${state.failed}.` });
            } catch (error) {
                try { _vendetta.logger?.error?.("[Message Purger] purge failed", error); } catch {}
                update({ running: false, done: true, status: `Purge failed: ${String(error)}` });
            }
        })().finally(() => { activeCancel = undefined; });
        return { cancel: () => { cancelled = true; } };
    }

    function Settings() {
        const [channelId, setChannelId] = React.useState("");
        const [after, setAfter] = React.useState("");
        const [before, setBefore] = React.useState("");
        const [progress, setProgress] = React.useState(() => getState());
        React.useEffect(() => {
            const unsubscribe = subscribe(() => setProgress(getState()));
            return () => unsubscribe();
        }, []);
        const running = progress?.running ?? false;
        const start = () => {
            const afterDate = parseDate(after);
            const beforeDate = parseDate(before);
            if ((after && !afterDate) || (before && !beforeDate)) return showToast("Enter dates as YYYY-MM-DD.");
            if (!startPurge(channelId.trim(), afterDate, beforeDate)) showToast("A purge is already running.");
        };
        const pressStart = () => {
            if (!channelId.trim()) return showToast("Enter a channel ID first.");
            showConfirmationAlert({ title: "Start Message Purge?", content: "Deletion is permanent and only your messages will be removed.", confirmText: "Start Purge", cancelText: "Cancel", confirmColor: "red", onConfirm: start });
        };
        return React.createElement(ScrollView, { style: { flex: 1, padding: 16 } },
            React.createElement(Text, { style: { fontSize: 22, fontWeight: "bold", marginBottom: 16 } }, "Message Purger"),
            React.createElement(Text, null, "Channel ID"), React.createElement(TextInput, { value: channelId, onChangeText: setChannelId, editable: !running, placeholder: "123456789012345678", style: { borderWidth: 1, padding: 10, marginBottom: 12, color: "white" } }),
            React.createElement(Text, null, "After (optional)"), React.createElement(TextInput, { value: after, onChangeText: setAfter, editable: !running, placeholder: "YYYY-MM-DD", style: { borderWidth: 1, padding: 10, marginBottom: 12, color: "white" } }),
            React.createElement(Text, null, "Before (optional)"), React.createElement(TextInput, { value: before, onChangeText: setBefore, editable: !running, placeholder: "YYYY-MM-DD", style: { borderWidth: 1, padding: 10, marginBottom: 16, color: "white" } }),
            React.createElement(TouchableOpacity, { onPress: running ? activeCancel : pressStart, style: { backgroundColor: running ? "#4f545c" : "#da373c", padding: 13, alignItems: "center" } }, React.createElement(Text, { style: { color: "white", fontWeight: "bold" } }, running ? "Cancel" : "Start Purge")),
            progress && React.createElement(View, { style: { padding: 12, marginTop: 16 } }, React.createElement(Text, null, `Status: ${progress.status}`), React.createElement(Text, null, `Scanned: ${progress.scanned}`), React.createElement(Text, null, `Found: ${progress.found}`), React.createElement(Text, null, `Deleted: ${progress.deleted}`), React.createElement(Text, null, `Failed: ${progress.failed}`)),
            React.createElement(Text, { style: { marginTop: 16, opacity: 0.65 } }, "Deletion is permanent. Only messages authored by the currently logged-in account are eligible."));
    }

    const index = {
        onLoad() { try { _vendetta.logger?.log?.("[Message Purger] loaded"); } catch {} },
        onUnload() { try { _vendetta.logger?.log?.("[Message Purger] unloaded"); } catch {} },
        settings: Settings,
    };
    exports.default = index;
    Object.defineProperty(exports, "__esModule", { value: true });
    return exports;
})({}, vendetta.plugin, vendetta.metro, vendetta.metro.common, vendetta.patcher, vendetta.ui.assets, vendetta.ui.toasts, vendetta.utils, vendetta, vendetta.ui, vendetta.storage)
