<template>
    <UFormField :label="$t('logbookTags')" :help="help" :error="tooMany ? $t('logbookTagsTooMany', { max }) : false">
        <div class="flex flex-wrap items-center gap-2">
            <UTooltip v-if="context === 'simulation'" :text="$t('logbookTagsSimulationFixed')">
                <UBadge :label="SIMULATION_TAG" variant="soft" color="neutral" icon="i-lucide-lock" />
            </UTooltip>
            <UInputMenu
                v-model="selected"
                v-model:search-term="search"
                multiple
                create-item
                open-on-click
                :items="items"
                :loading="logbook.loadingTags"
                :placeholder="$t('logbookTagsPlaceholder')"
                class="min-w-64 flex-1"
                @create="create"
                @update:open="(open) => open && logbook.loadTags()"
            />
        </div>
    </UFormField>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { cleanTags, TAGS_PER_ENTRY_MAX } from "@/js/indiflight/logbookClient";
import { SIMULATION_TAG, useLogbookStore } from "@/stores/logbook";

/** Tags for the next uploads to the log database: the server's tags to pick from, and new ones to type. */
const props = defineProps({
    context: { type: String, default: "blackbox", validator: (v) => ["blackbox", "simulation"].includes(v) },
});

const { t } = useTranslation();
const logbook = useLogbookStore();
const search = ref("");
const max = TAGS_PER_ENTRY_MAX;

const fixed = computed(() => (props.context === "simulation" ? [SIMULATION_TAG] : []));
const isFixed = (name) => fixed.value.some((f) => f.toLowerCase() === name.toLowerCase());

const selected = computed({
    get: () => logbook.tags[props.context],
    set: (names) => {
        logbook.tags = { ...logbook.tags, [props.context]: cleanTags(names).filter((n) => !isFixed(n)) };
        logbook.persist();
    },
});

// Chosen names stay in the list, so a tag the server does not have yet can still be removed in the menu
const items = computed(() =>
    cleanTags([...logbook.knownTags.map((tag) => tag.name), ...selected.value]).filter((n) => !isFixed(n)),
);

const tooMany = computed(() => fixed.value.length + selected.value.length > max);

const help = computed(() =>
    logbook.knownTagsError ? t("logbookTagsNoList", { error: logbook.knownTagsError }) : t("logbookTagsHelp"),
);

function create(text) {
    // An existing tag typed in another case is that tag
    const names = cleanTags([text]).map(
        (name) => items.value.find((known) => known.toLowerCase() === name.toLowerCase()) ?? name,
    );
    selected.value = [...selected.value, ...names];
    search.value = "";
}

// Also reloaded when the menu opens, which picks up a changed server or key
onMounted(() => logbook.loadTags());
</script>
