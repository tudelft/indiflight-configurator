import { set as setConfig } from "../ConfigStorage";
import { updateTabList } from "./updateTabList";
import FC from "../fc";
import GUI, { TABS } from "../gui";
import { EventBus } from "../../components/eventBus";

export function applyExpertMode(checked, { persist = true } = {}) {
    if (globalThis.vm) {
        globalThis.vm.expertMode = checked;
    }

    updateTabList(FC.FEATURE_CONFIG?.features);

    if (GUI.active_tab) {
        TABS[GUI.active_tab]?.expertModeChanged?.(checked);
    }

    EventBus.$emit("expert-mode-change", checked);

    if (persist) {
        setConfig({ expertMode: checked });
    }
}
