import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// The build daemon is untrusted input: the URL is user-entered and could point anywhere.
vi.mock("../../src/js/indiflight/localBuilderClient", () => ({
    DEFAULT_BUILDER_URL: "http://127.0.0.1:8742",
    LocalBuilderClient: class {
        ping = async () => ({ tokenRequired: false });
        info = async () => ({ activeJob: null });
        configs = async () => ({ boards: ["B"], profiles: [] });
        configFile = async () => "#define TARGET=STM32H743\n";
        artifactText = async () => ":00000001FF\n";
    },
}));

import { useLocalBuildStore } from "../../src/stores/localBuild.js";

async function connectedStoreWithArtifact(name) {
    const store = useLocalBuildStore();
    await store.connect();
    store.job = { id: "j1", state: "success", artifacts: [{ name, kind: "hex", size: 12 }] };
    return store;
}

describe("localBuild store fetchHex", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        localStorage.clear();
    });

    it("hands over a normally named hex", async () => {
        const store = await connectedStoreWithArtifact("indiflight_5.0.0_STM32H743.hex");
        await expect(store.fetchHex()).resolves.toEqual({
            name: "indiflight_5.0.0_STM32H743.hex",
            text: ":00000001FF\n",
        });
    });

    it.each([
        ['<img src=x onerror="alert(1)">.hex'],
        ["../../evil.hex"],
        [".hidden.hex"],
        ["firmware.hex.exe"],
        ["firm ware.hex"],
    ])("refuses the artifact name %j, which the flasher would show as HTML", async (name) => {
        const store = await connectedStoreWithArtifact(name);
        await expect(store.fetchHex()).rejects.toThrow(/unexpected artifact name/);
    });
});
