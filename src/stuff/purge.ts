import { findByProps, findByStoreName } from "@vendetta/metro";
import { logger } from "@vendetta";

const UserStore = findByStoreName("UserStore");
const RestAPI = findByProps("getAPIBaseURL", "get", "del");

export interface PurgeOptions {
    channelId: string;
    afterDate?: Date;
    beforeDate?: Date;
    onProgress: (state: PurgeProgress) => void;
}

export interface PurgeProgress {
    status: string;
    scanned: number;
    found: number;
    deleted: number;
    failed: number;
    done: boolean;
    cancelled: boolean;
}

interface DiscordMessage {
    id: string;
    author?: { id: string };
    timestamp: string;
}

export interface PurgeHandle {
    cancel: () => void;
}

const DELETE_DELAY_MS = 900;
const FETCH_PAGE_SIZE = 100;

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function startPurge(options: PurgeOptions): PurgeHandle {
    const { channelId, afterDate, beforeDate, onProgress } = options;

    let cancelled = false;
    const cancel = () => {
        cancelled = true;
    };

    const selfId = UserStore?.getCurrentUser?.()?.id;
    const progress: PurgeProgress = {
        status: "Starting...",
        scanned: 0,
        found: 0,
        deleted: 0,
        failed: 0,
        done: false,
        cancelled: false,
    };
    const emit = () => onProgress({ ...progress });

    (async () => {
        if (!selfId) {
            progress.status = "Could not determine current user. Aborting.";
            progress.done = true;
            emit();
            return;
        }

        if (!RestAPI?.get || !RestAPI?.del) {
            progress.status = "Could not find Discord's internal REST module.";
            progress.done = true;
            emit();
            return;
        }

        let beforeCursor: string | undefined;
        const toDelete: string[] = [];

        progress.status = "Scanning message history...";
        emit();

        while (!cancelled) {
            let page: DiscordMessage[];
            try {
                const response = await RestAPI.get({
                    url: `/channels/${channelId}/messages`,
                    query: {
                        limit: FETCH_PAGE_SIZE,
                        ...(beforeCursor ? { before: beforeCursor } : {}),
                    },
                });
                page = response?.body ?? [];
            } catch (error) {
                logger.error("[Message Purger] failed to fetch messages", error);
                progress.status = `Failed to fetch messages: ${String(error)}`;
                progress.done = true;
                emit();
                return;
            }

            if (!page.length) break;

            for (const message of page) {
                progress.scanned++;

                if (message.author?.id !== selfId) continue;

                const timestamp = new Date(message.timestamp);
                if (afterDate && timestamp < afterDate) continue;
                if (beforeDate && timestamp > beforeDate) continue;

                toDelete.push(message.id);
                progress.found++;
            }

            emit();

            beforeCursor = page[page.length - 1].id;
            if (page.length < FETCH_PAGE_SIZE) break;

            await sleep(300);
        }

        if (cancelled) {
            progress.status = "Cancelled during scan.";
            progress.cancelled = true;
            progress.done = true;
            emit();
            return;
        }

        progress.status = `Deleting ${toDelete.length} message(s)...`;
        emit();

        for (const id of toDelete) {
            if (cancelled) break;

            let retriesLeft = 3;
            while (retriesLeft > 0) {
                try {
                    await RestAPI.del({ url: `/channels/${channelId}/messages/${id}` });
                    progress.deleted++;
                    break;
                } catch (error: any) {
                    const retryAfter = error?.body?.retry_after ?? error?.retry_after;
                    if (retryAfter) {
                        progress.status = `Rate limited, waiting ${retryAfter}s...`;
                        emit();
                        await sleep(retryAfter * 1000 + 250);
                        retriesLeft--;
                        continue;
                    }

                    logger.error("[Message Purger] failed to delete", id, error);
                    progress.failed++;
                    break;
                }
            }

            progress.status = `Deleted ${progress.deleted}/${toDelete.length}`;
            emit();
            await sleep(DELETE_DELAY_MS);
        }

        progress.cancelled = cancelled;
        progress.status = cancelled
            ? `Cancelled. Deleted ${progress.deleted} before stopping.`
            : `Done. Deleted ${progress.deleted}, failed ${progress.failed}.`;
        progress.done = true;
        emit();
    })();

    return { cancel };
}
