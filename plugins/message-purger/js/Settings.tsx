import React from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
    cancelActivePurge,
    getPurgeState,
    startPurge,
    subscribePurge,
} from "./purge";

interface SettingsProps {
    api: any;
}

function parseDate(input: string): Date | undefined {
    if (!input.trim()) return undefined;
    const date = new Date(`${input.trim()}T00:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function showToast(api: any, content: string) {
    api.discord.actions.ToastActionCreators.open({
        key: "message-purger",
        content,
    });
}

function Confirmation({
    api,
    onConfirm,
    onCancel,
}: {
    api: any;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <View style={{ padding: 20 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", marginBottom: 12 }}>
                Start Message Purge?
            </Text>
            <Text style={{ marginBottom: 20 }}>
                This permanently deletes messages authored by your account. This
                cannot be undone.
            </Text>
            <View
                style={{
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    gap: 12,
                }}
            >
                <Pressable onPress={onCancel} style={{ padding: 12 }}>
                    <Text>Cancel</Text>
                </Pressable>
                <Pressable
                    onPress={onConfirm}
                    style={{
                        backgroundColor: "#da373c",
                        borderRadius: 6,
                        padding: 12,
                    }}
                >
                    <Text style={{ color: "white", fontWeight: "700" }}>
                        Start Purge
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

export default function Settings({ api }: SettingsProps) {
    const [channelId, setChannelId] = React.useState("");
    const [afterInput, setAfterInput] = React.useState("");
    const [beforeInput, setBeforeInput] = React.useState("");
    const [progress, setProgress] = React.useState(() => getPurgeState());

    React.useEffect(() => {
        const unsubscribe = subscribePurge(() => setProgress(getPurgeState()));
        return () => unsubscribe();
    }, []);

    const running = progress?.running ?? false;

    const reallyStart = () => {
        const afterDate = parseDate(afterInput);
        const beforeDate = parseDate(beforeInput);
        if (afterInput.trim() && !afterDate) {
            showToast(api, "Couldn't parse the After date.");
            return;
        }
        if (beforeInput.trim() && !beforeDate) {
            showToast(api, "Couldn't parse the Before date.");
            return;
        }

        const handle = startPurge({
            api,
            channelId: channelId.trim(),
            afterDate,
            beforeDate,
        });
        if (!handle) showToast(api, "A purge is already running.");
    };

    const onStartPress = () => {
        if (!channelId.trim()) {
            showToast(api, "Enter a channel ID first.");
            return;
        }
        api.discord.actions.AlertActionCreators.openAlert(
            "message-purger-confirm",
            React.createElement(Confirmation, {
                api,
                onConfirm: () => {
                    api.discord.actions.AlertActionCreators.dismissAlert(
                        "message-purger-confirm",
                    );
                    reallyStart();
                },
                onCancel: () =>
                    api.discord.actions.AlertActionCreators.dismissAlert(
                        "message-purger-confirm",
                    ),
            }),
        );
    };

    return (
        <ScrollView style={{ flex: 1, padding: 16 }}>
            <Text style={{ fontSize: 22, fontWeight: "700", marginBottom: 16 }}>
                Message Purger
            </Text>
            <Text style={{ marginBottom: 6 }}>Channel ID</Text>
            <TextInput
                value={channelId}
                onChangeText={setChannelId}
                editable={!running}
                placeholder="123456789012345678"
                style={{
                    borderWidth: 1,
                    borderColor: "#555",
                    borderRadius: 6,
                    padding: 10,
                    marginBottom: 14,
                    color: "white",
                }}
            />
            <Text style={{ marginBottom: 6 }}>After (optional)</Text>
            <TextInput
                value={afterInput}
                onChangeText={setAfterInput}
                editable={!running}
                placeholder="YYYY-MM-DD"
                style={{
                    borderWidth: 1,
                    borderColor: "#555",
                    borderRadius: 6,
                    padding: 10,
                    marginBottom: 14,
                    color: "white",
                }}
            />
            <Text style={{ marginBottom: 6 }}>Before (optional)</Text>
            <TextInput
                value={beforeInput}
                onChangeText={setBeforeInput}
                editable={!running}
                placeholder="YYYY-MM-DD"
                style={{
                    borderWidth: 1,
                    borderColor: "#555",
                    borderRadius: 6,
                    padding: 10,
                    marginBottom: 18,
                    color: "white",
                }}
            />
            <Pressable
                onPress={running ? cancelActivePurge : onStartPress}
                style={{
                    backgroundColor: running ? "#4f545c" : "#da373c",
                    borderRadius: 6,
                    padding: 13,
                    alignItems: "center",
                    marginBottom: 18,
                }}
            >
                <Text style={{ color: "white", fontWeight: "700" }}>
                    {running ? "Cancel" : "Start Purge"}
                </Text>
            </Pressable>
            {progress && (
                <View
                    style={{
                        borderWidth: 1,
                        borderColor: "#333",
                        borderRadius: 6,
                        padding: 12,
                    }}
                >
                    <Text>Status: {progress.status}</Text>
                    <Text>Scanned: {progress.scanned}</Text>
                    <Text>Found: {progress.found}</Text>
                    <Text>Deleted: {progress.deleted}</Text>
                    <Text>Failed: {progress.failed}</Text>
                </View>
            )}
            <Text style={{ marginTop: 18, opacity: 0.65 }}>
                Deletion is permanent. Only messages authored by the currently
                logged-in account are eligible.
            </Text>
        </ScrollView>
    );
}
