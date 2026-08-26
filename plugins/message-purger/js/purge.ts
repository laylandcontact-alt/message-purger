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

const INITIAL_DELETE_DELAY_MS = 800;
const MIN_DELETE_DELAY_MS = 450;
const MAX_DELETE_DELAY_MS = 8_000;
const DELAY_STEP_MS = 50;
const SUCCESS_STREAK_FOR_SPEEDUP = 5;
const RATE_LIMIT_MARGIN_MS = 250;
const FETCH_PAGE_SIZE = 100;
let activeHandle: PurgeHandle | undefined;

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepWhileActive(
    ms: number,
    isCancelled: () => boolean,
): Promise<boolean> {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const timer = setInterval(
            () => {
                if (isCancelled()) {
                    clearInterval(timer);
                    resolve(false);
                } else if (Date.now() - startedAt >= ms) {
                    clearInterval(timer);
                    resolve(true);
                }
            },
            Math.min(100, Math.max(1, ms)),
        );
    });
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
        let deleteDelayMs = INITIAL_DELETE_DELAY_MS;
        let successfulSinceRateLimit = 0;
        for (const id of toDelete) {
            if (cancelled) break;

            let retriesLeft = 3;
            let deleted = false;
            while (retriesLeft > 0) {
                try {
                    await restApi.del({
                        url: `/channels/${channelId}/messages/${id}`,
                    });
                    progress.deleted++;
                    successfulSinceRateLimit++;
                    deleted = true;
                    break;
                } catch (error: any) {
                    const retryAfter =
                        error?.body?.retry_after ?? error?.retry_after;
                    if (retryAfter !== undefined) {
                        progress.status = `Rate limited, waiting ${retryAfter}s...`;
                        emit();
                        const retryWait = await sleepWhileActive(
                            Number(retryAfter) * 1000 + RATE_LIMIT_MARGIN_MS,
                            () => cancelled,
                        );
                        if (!retryWait) break;
                        deleteDelayMs = Math.min(
                            MAX_DELETE_DELAY_MS,
                            Math.max(
                                deleteDelayMs * 2,
                                Number(retryAfter) * 1000 +
                                    RATE_LIMIT_MARGIN_MS,
                            ),
                        );
                        successfulSinceRateLimit = 0;
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
            if (cancelled) break;
            if (
                deleted &&
                successfulSinceRateLimit >= SUCCESS_STREAK_FOR_SPEEDUP
            ) {
                deleteDelayMs = Math.max(
                    MIN_DELETE_DELAY_MS,
                    deleteDelayMs - DELAY_STEP_MS,
                );
                successfulSinceRateLimit = 0;
            }
            if (!(await sleepWhileActive(deleteDelayMs, () => cancelled)))
                break;
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
