vendetta => {
    const { React, ReactNative: RN } = vendetta.metro.common;
    const { findByProps, findByStoreName } = vendetta.metro;
    const { showConfirmationAlert } = vendetta.ui.alerts;
    const { showToast } = vendetta.ui.toasts;
    const { View, Text, TextInput, TouchableOpacity, ScrollView } = RN;
    const UserStore = findByStoreName("UserStore");
    const RestAPI = findByProps("getAPIBaseURL", "get", "del");
    let activeCancel;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const parseDate = value => {
        if (!value.trim()) return undefined;
        const date = new Date(`${value.trim()}T00:00:00`);
        return Number.isNaN(date.getTime()) ? undefined : date;
    };

    function startPurge(channelId, afterDate, beforeDate, onProgress) {
        let cancelled = false;
        const progress = { status: "Starting...", scanned: 0, found: 0, deleted: 0, failed: 0, done: false, cancelled: false };
        const emit = () => onProgress({ ...progress });
        activeCancel = () => { cancelled = true; };

        (async () => {
            const selfId = UserStore?.getCurrentUser?.()?.id;
            if (!selfId || !RestAPI?.get || !RestAPI?.del) {
                progress.status = "Could not access Discord user or REST APIs.";
                progress.done = true;
                emit();
                return;
            }
            const ids = [];
            let before;
            progress.status = "Scanning message history...";
            emit();
            while (!cancelled) {
                let page;
                try {
                    const response = await RestAPI.get({ url: `/channels/${channelId}/messages`, query: { limit: 100, ...(before ? { before } : {}) } });
                    page = response?.body ?? [];
                } catch (error) {
                    progress.status = `Failed to fetch messages: ${String(error)}`;
                    progress.done = true;
                    emit();
                    return;
                }
                if (!Array.isArray(page) || !page.length) break;
                for (const message of page) {
                    progress.scanned++;
                    if (message.author?.id !== selfId) continue;
                    const date = new Date(message.timestamp);
                    if (afterDate && date < afterDate) continue;
                    if (beforeDate && date > beforeDate) continue;
                    ids.push(message.id);
                    progress.found++;
                }
                emit();
                before = page[page.length - 1]?.id;
                if (page.length < 100) break;
                await sleep(300);
            }
            if (cancelled) {
                progress.status = "Cancelled during scan.";
                progress.cancelled = true;
                progress.done = true;
                emit();
                return;
            }
            for (const id of ids) {
                if (cancelled) break;
                let retries = 3;
                while (retries-- > 0) {
                    try {
                        await RestAPI.del({ url: `/channels/${channelId}/messages/${id}` });
                        progress.deleted++;
                        break;
                    } catch (error) {
                        const retryAfter = error?.body?.retry_after ?? error?.retry_after;
                        if (retryAfter !== undefined) {
                            progress.status = `Rate limited, waiting ${retryAfter}s...`;
                            emit();
                            await sleep(Number(retryAfter) * 1000 + 250);
                        } else {
                            progress.failed++;
                            break;
                        }
                    }
                }
                progress.status = `Deleted ${progress.deleted}/${ids.length}`;
                emit();
                await sleep(900);
            }
            progress.cancelled = cancelled;
            progress.status = cancelled ? `Cancelled. Deleted ${progress.deleted} before stopping.` : `Done. Deleted ${progress.deleted}, failed ${progress.failed}.`;
            progress.done = true;
            emit();
        })();
        return () => { cancelled = true; };
    }

    function Settings() {
        const [channelId, setChannelId] = React.useState("");
        const [after, setAfter] = React.useState("");
        const [before, setBefore] = React.useState("");
        const [running, setRunning] = React.useState(false);
        const [progress, setProgress] = React.useState(null);
        const start = () => {
            const afterDate = parseDate(after);
            const beforeDate = parseDate(before);
            if ((after && !afterDate) || (before && !beforeDate)) {
                showToast("Enter dates as YYYY-MM-DD.");
                return;
            }
            setRunning(true);
            startPurge(channelId.trim(), afterDate, beforeDate, state => {
                setProgress(state);
                if (state.done) setRunning(false);
            });
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

    return { onLoad() {}, onUnload() { activeCancel?.(); }, settings: Settings };
}
