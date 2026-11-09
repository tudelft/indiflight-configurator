<template>
    <BaseTab tab-name="help">
        <div class="content_wrapper">
            <div class="tab_title">{{ $t("tabHelp") }}</div>
            <div class="grid-row grid-box col5">
                <div class="col-span-3">
                    <UiBox :title="$t('defaultDocumentationHead')" class="sm:h-full">
                        <p v-html="$t('indiflightDocumentation')"></p>
                    </UiBox>
                </div>
                <div class="col-span-2">
                    <UiBox :title="$t('defaultSupportHead')" class="sm:h-full">
                        <p v-html="$t('indiflightSupport')"></p>
                    </UiBox>
                </div>
            </div>
        </div>
    </BaseTab>
</template>

<script>
import { defineComponent } from "vue";
import BaseTab from "./BaseTab.vue";
import GUI from "../../js/gui";
import UiBox from "../elements/UiBox.vue";

export default defineComponent({
    name: "HelpTab",
    components: {
        BaseTab,
        UiBox,
    },
    setup() {
        // Called after tab is ready - equivalent to old content_ready callback
        function onTabReady() {
            GUI.content_ready();
        }

        return { onTabReady };
    },
    mounted() {
        this.onTabReady();
    },
});
</script>

<style lang="less">
.tab-help {
    ul {
        margin-bottom: 15px;
    }

    li {
        border-top: 1px dotted var(--surface-500);
        padding-top: 5px;
        padding-bottom: 5px;
        background-image: url(../../images/arrow.svg);
        background-repeat: no-repeat;
        background-position: 0 8px;
        background-size: 12px;

        span {
            margin-left: 17px;
            display: block;

            a {
                color: var(--primary-500);
            }
        }
    }

    .subline {
        margin-bottom: 5px;
    }

    @media all and (max-width: 575px) {
        .grid-box {
            &.col5 {
                grid-template-columns: 1fr !important;
            }
            .col-span-2 {
                grid-column: span 1;
            }
            .col-span-3 {
                grid-column: span 1;
            }
        }
    }
}
</style>
