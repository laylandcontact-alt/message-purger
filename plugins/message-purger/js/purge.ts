import { lookupModule } from "@revenge-mod/modules/finders";
import { withProps } from "@revenge-mod/modules/finders/filters";

export interface PurgeOptions {
    channelId: string;
    afterDate?: Date;
    beforeDate?: Date;
    onProgress: (state: PurgeProgress) => void;
    api: any;
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

export interface PurgeHandle {
    cancel: () => void;
}

interface DiscordMessage {
    id: string;
    author?: { id?: string };
    timestamp: string;
}

interface DiscordModule {
    getCurrentUser?: () => { id?: string };
    getAPIBaseURL?: () => string;
    get?: (request: {
        url: string;
        query: Record<string, string | number>;
    }) => Promise<any>;
    del?: (request: { url: string }) => Promise<unknown>;
}

const DELETE_DELAY_MS = 275;
const FETCH_PAGE_SIZE = 100;
let activeHandle: PurgeHandle | undefined;

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function findModule<T extends DiscordModule>(
    ...props: string[]
): T | undefined {
    const result = lookupModule(withProps(...props)) as unknown as
        | [T, unknown]
        | readonly [];
    return result.length ? result[0] : undefined;
}

function getLogger(api: any) {
    const Logger = api.discord.common.logger?.Logger;
    return Logger ? new Logger("Message Purger") : console;
}

export function startPurge(options: PurgeOptions): PurgeHandle {
    const { channelId, afterDate, beforeDate, onProgress, api } = options;
    const userStore = findModule("getCurrentUser");
    const restApi = findModule("getAPIBaseURL", "get", "del");
    const logger = getLogger(api);
    let cancelled = false;

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
    const handle: PurgeHandle = {
        cancel: () => {
            cancelled = true;
        },
    };
    activeHandle = handle;

    (async () => {
        const selfId = userStore?.getCurrentUser?.()?.id;
        if (!selfId) {
            progress.status = "Could not determine current user. Aborting.";
            progress.done = true;
            emit();
            return;
        }

        if (!restApi?.get || !restApi?.del) {
            progress.status = "Could not find Discord's REST module. Aborting.";
            progress.done = true;
            emit();
            return;
        }

        const toDelete: string[] = [];
        let beforeCursor: string | undefined;
        progress.status = "Scanning message history...";
        emit();

        while (!cancelled) {
            let page: DiscordMessage[];
            try {
                const response = await restApi.get({
                    url: `/channels/${channelId}/messages`,
                    query: {
                        limit: FETCH_PAGE_SIZE,
                        ...(beforeCursor ? { before: beforeCursor } : {}),
                    },
                });
                page = response?.body ?? [];
            } catch (error) {
                logger.error(
                    "[Message Purger] failed to fetch messages",
                    error,
                );
                progress.status = `Failed to fetch messages: ${String(error)}`;
                progress.done = true;
                emit();
                return;
            }

            if (!Array.isArray(page) || page.length === 0) break;

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

            beforeCursor = page[page.length - 1]?.id;
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
                    await restApi.del({
                        url: `/channels/${channelId}/messages/${id}`,
                    });
                    progress.deleted++;
                    break;
                } catch (error: any) {
                    const retryAfter =
                        error?.body?.retry_after ?? error?.retry_after;
                    if (retryAfter !== undefined) {
                        progress.status = `Rate limited, waiting ${retryAfter}s...`;
                        emit();
                        await sleep(Number(retryAfter) * 1000 + 250);
                        retriesLeft--;
                        continue;
                    }
                    logger.error(
                        "[Message Purger] failed to delete",
                        id,
                        error,
                    );
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
    })().finally(() => {
        if (activeHandle === handle) activeHandle = undefined;
    });

    return handle;
}

export function cancelActivePurge() {
    activeHandle?.cancel();
}
