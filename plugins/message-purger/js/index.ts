import { cancelActivePurge } from "./purge";
import Settings from "./Settings";

export default plugin({
    SettingsComponent: Settings,
    start() {
        console.info("[Message Purger] started");
    },
    stop() {
        cancelActivePurge();
        console.info("[Message Purger] stopped");
    },
});
