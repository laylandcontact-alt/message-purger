import { React, ReactNative as RN } from "@vendetta/metro/common";
import { showConfirmationAlert } from "@vendetta/ui/alerts";
import { showToast } from "@vendetta/ui/toasts";

import { startPurge } from "../stuff/purge";

const { View, Text, TextInput, TouchableOpacity, ScrollView } = RN;

function parseDate(input: string): Date | undefined {
    if (!input.trim()) return undefined;
    const date = new Date(input.trim());
    return Number.isNaN(date.getTime()) ? undefined : date;
}

export default function Settings() {
    const [channelId, setChannelId] = React.useState("");
    const [afterInput, setAfterInput] = React.useState("");
    const [beforeInput, setBeforeInput] = React.useState("");
    const [running, setRunning] = React.useState(false);
    const [progress, setProgress] = React.useState(null);
    const handleRef = React.useRef(null);

    const reallyStart = () => {
        const afterDate = parseDate(afterInput);
        const beforeDate = parseDate(beforeInput);

        if (afterInput.trim() && !afterDate) {
            showToast("Couldn't parse the 'After' date.");
            return;
        }
        if (beforeInput.trim() && !beforeDate) {
            showToast("Couldn't parse the 'Before' date.");
            return;
        }

        setRunning(true);
        handleRef.current = startPurge({
            channelId: channelId.trim(),
            afterDate,
            beforeDate,
            onProgress: state => {
                setProgress(state);
                if (state.done) setRunning(false);
            },
        });
    };

    const onStartPress = () => {
        if (!channelId.trim()) {
            showToast("Enter a channel ID first.");
            return;
        }

        showConfirmationAlert({
            title: "Start Message Purge?",
            content:
                "This will permanently delete messages you authored in this channel" +
                (afterInput || beforeInput ? " within the given date range." : ".") +
                " This cannot be undone.",
            confirmText: "Start Purge",
            cancelText: "Cancel",
            confirmColor: "red",
            onConfirm: reallyStart,
        });
    };

    const onCancelPress = () => {
        handleRef.current?.cancel();
    };

    return (
        <ScrollView style={{ flex: 1, padding: 16 }}>
            <Text style={{ fontSize: 20, fontWeight: "bold", marginBottom: 12 }}>
                Message Purger
            </Text>

            <Text style={{ marginBottom: 4 }}>Channel ID</Text>
            <TextInput
                value={channelId}
                onChangeText={setChannelId}
                placeholder="e.g. 123456789012345678"
                editable={!running}
                style={{ borderWidth: 1, borderColor: "#555", borderRadius: 6, padding: 8, marginBottom: 12, color: "white" }}
            />

            <Text style={{ marginBottom: 4 }}>After (optional, e.g. 2024-01-01)</Text>
            <TextInput
                value={afterInput}
                onChangeText={setAfterInput}
                placeholder="YYYY-MM-DD"
                editable={!running}
                style={{ borderWidth: 1, borderColor: "#555", borderRadius: 6, padding: 8, marginBottom: 12, color: "white" }}
            />

            <Text style={{ marginBottom: 4 }}>Before (optional, e.g. 2024-06-01)</Text>
            <TextInput
                value={beforeInput}
                onChangeText={setBeforeInput}
                placeholder="YYYY-MM-DD"
                editable={!running}
                style={{ borderWidth: 1, borderColor: "#555", borderRadius: 6, padding: 8, marginBottom: 16, color: "white" }}
            />

            {!running ? (
                <TouchableOpacity
                    onPress={onStartPress}
                    style={{ backgroundColor: "#da373c", borderRadius: 6, padding: 12, alignItems: "center", marginBottom: 16 }}
                >
                    <Text style={{ color: "white", fontWeight: "bold" }}>Start Purge</Text>
                </TouchableOpacity>
            ) : (
                <TouchableOpacity
                    onPress={onCancelPress}
                    style={{ backgroundColor: "#4f545c", borderRadius: 6, padding: 12, alignItems: "center", marginBottom: 16 }}
                >
                    <Text style={{ color: "white", fontWeight: "bold" }}>Cancel</Text>
                </TouchableOpacity>
            )}

            {progress && (
                <View style={{ borderWidth: 1, borderColor: "#333", borderRadius: 6, padding: 12 }}>
                    <Text style={{ marginBottom: 4 }}>Status: {progress.status}</Text>
                    <Text>Scanned: {progress.scanned}</Text>
                    <Text>Found: {progress.found}</Text>
                    <Text>Deleted: {progress.deleted}</Text>
                    <Text>Failed: {progress.failed}</Text>
                </View>
            )}

            <Text style={{ marginTop: 16, fontSize: 12, opacity: 0.6 }}>
                Only deletes messages authored by the currently logged-in account.
                Runs with deliberate delays between requests to respect Discord's
                rate limits - large purges will take time.
            </Text>
        </ScrollView>
    );
}
