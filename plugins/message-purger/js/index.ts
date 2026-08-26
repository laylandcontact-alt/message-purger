import Settings from "./Settings";

export default plugin({
    SettingsComponent: Settings,
    start() {
        console.info("[Message Purger] started");
    },
    stop() {
        console.info("[Message Purger] stopped");
    },
});
