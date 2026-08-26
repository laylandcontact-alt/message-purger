import Settings from "./components/Settings";

export function onLoad() {
    // No persistent state needed on load.
}

export function onUnload() {
    // Any in-flight purge keeps running in its own closure; nothing to
    // tear down here since we don't patch any Discord internals globally.
}

export const settings = Settings;
