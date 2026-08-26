import { lookupModule } from "@revenge-mod/modules/finders";
import { withProps } from "@revenge-mod/modules/finders/filters";

export interface PurgeOptions {
    channelId: string;
    afterDate?: Date;
    beforeDate?: Date;
    api: any;
}

export interface PurgeProgress {
    running: boolean;
    status: string;
    scanned: number;
    found: number;
    deleted: number;
    failed: number;
    cancelled: boolean;
    done: boolean;
    channelId: string;
    startedAt: number;
    delayMs: number;
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
let purgeState: PurgeProgress | undefined;
const listeners = new Set<() => void>();

function notify() {
    for (const listener of listeners) listener();
}

export function subscribePurge(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getPurgeState() {
    return purgeState;
}

function updatePurgeState(update: Partial<PurgeProgress>) {
    if (!purgeState) return;
    purgeState = { ...purgeState, ...update };
    notify();
}

function sleepWhileActive(ms: number, isCancelled: () => boolean) {
    return new Promise<boolean>((resolve) => {
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

export function startPurge(options: PurgeOptions): PurgeHandle | undefined {
    if (purgeState?.running) return undefined;

    const { channelId, afterDate, beforeDate, api } = options;
    let cancelled = false;
    const handle: PurgeHandle = {
        cancel: () => {
            cancelled = true;
        },
    };
    activeHandle = handle;
    purgeState = {
        running: true,
        status: "Starting...",
        scanned: 0,
        found: 0,
        deleted: 0,
        failed: 0,
        cancelled: false,
        done: false,
        channelId,
        startedAt: Date.now(),
        delayMs: INITIAL_DELETE_DELAY_MS,
    };
    notify();

    const emit = (update: Partial<PurgeProgress> = {}) =>
        updatePurgeState(update);

    (async () => {
        const logger = getLogger(api);
        const userStore = findModule("getCurrentUser");
        const restApi = findModule("getAPIBaseURL", "get", "del");
        const selfId = userStore?.getCurrentUser?.()?.id;

        try {
            if (!selfId) {
                emit({
                    running: false,
                    status: "Could not determine current user. Aborting.",
                    done: true,
                });
                return;
            }
            if (!restApi?.get || !restApi?.del) {
                emit({
                    running: false,
                    status: "Could not find Discord's REST module. Aborting.",
                    done: true,
                });
                return;
            }

            const toDelete: string[] = [];
            let beforeCursor: string | undefined;
            emit({ status: "Scanning message history..." });

            while (!cancelled) {
                const response = await restApi.get({
                    url: `/channels/${channelId}/messages`,
                    query: {
                        limit: FETCH_PAGE_SIZE,
                        ...(beforeCursor ? { before: beforeCursor } : {}),
                    },
                });
                const page: DiscordMessage[] = response?.body ?? [];
                if (!Array.isArray(page) || page.length === 0) break;

                for (const message of page) {
                    purgeState!.scanned += 1;
                    if (message.author?.id !== selfId) continue;
                    const timestamp = new Date(message.timestamp);
                    if (afterDate && timestamp < afterDate) continue;
                    if (beforeDate && timestamp > beforeDate) continue;
                    toDelete.push(message.id);
                    purgeState!.found += 1;
                }
                notify();
                beforeCursor = page[page.length - 1]?.id;
                if (page.length < FETCH_PAGE_SIZE) break;
                if (!(await sleepWhileActive(300, () => cancelled))) break;
            }

            if (cancelled) {
                emit({ status: "Cancelled during scan.", cancelled: true });
                return;
            }

            emit({ status: `Deleting ${toDelete.length} message(s)...` });
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
                        purgeState!.deleted += 1;
                        successfulSinceRateLimit += 1;
                        deleted = true;
                        break;
                    } catch (error: any) {
                        const retryAfter =
                            error?.body?.retry_after ?? error?.retry_after;
                        if (retryAfter !== undefined) {
                            emit({
                                status: `Rate limited, waiting ${retryAfter}s...`,
                            });
                            if (
                                !(await sleepWhileActive(
                                    Number(retryAfter) * 1000 +
                                        RATE_LIMIT_MARGIN_MS,
                                    () => cancelled,
                                ))
                            )
                                break;
                            deleteDelayMs = Math.min(
                                MAX_DELETE_DELAY_MS,
                                Math.max(
                                    deleteDelayMs * 2,
                                    Number(retryAfter) * 1000 +
                                        RATE_LIMIT_MARGIN_MS,
                                ),
                            );
                            successfulSinceRateLimit = 0;
                            emit({ delayMs: deleteDelayMs });
                            retriesLeft -= 1;
                            continue;
                        }
                        logger.error(
                            "[Message Purger] failed to delete",
                            id,
                            error,
                        );
                        purgeState!.failed += 1;
                        break;
                    }
                }

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
                    emit({ delayMs: deleteDelayMs });
                }
                emit({
                    status: `Deleted ${purgeState!.deleted}/${toDelete.length}`,
                });
                if (!(await sleepWhileActive(deleteDelayMs, () => cancelled)))
                    break;
            }

            emit({
                running: false,
                cancelled,
                status: cancelled
                    ? `Cancelled. Deleted ${purgeState!.deleted} before stopping.`
                    : `Done. Deleted ${purgeState!.deleted}, failed ${purgeState!.failed}.`,
                done: true,
            });
        } catch (error) {
            logger.error("[Message Purger] purge failed", error);
            emit({
                running: false,
                status: `Purge failed: ${String(error)}`,
                done: true,
            });
        }
    })().finally(() => {
        if (activeHandle === handle) activeHandle = undefined;
    });

    return handle;
}

export function cancelActivePurge() {
    activeHandle?.cancel();
}
