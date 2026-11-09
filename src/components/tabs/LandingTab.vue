<template>
    <BaseTab tab-name="landing">
        <div class="content_wrapper">
            <div class="content_top">
                <div class="logowrapper">
                    <img src="/images/if_logo_dark.svg" alt="" />
                    <div v-html="$t('defaultWelcomeIntro')"></div>
                </div>
            </div>
            <div class="content_mid grid-row">
                <div class="column third_left text1 grid-col col4">
                    <div class="wrap">
                        <h2>{{ $t("indiflightAboutHead") }}</h2>
                        <div v-html="$t('indiflightAboutText')"></div>
                    </div>
                </div>
                <div class="column third_center text2 list grid-col col4">
                    <div class="wrap">
                        <h2>{{ $t("indiflightSourceHead") }}</h2>
                        <div v-html="$t('indiflightSourceText')"></div>
                    </div>
                </div>
                <div class="column third_right text1 grid-col col4">
                    <div class="wrap">
                        <h2>{{ $t("indiflightPrivacyHead") }}</h2>
                        <div v-html="$t('indiflightPrivacyText')"></div>
                    </div>
                </div>
                <div class="column third_left text2 list grid-col col4">
                    <div class="wrap">
                        <h2>{{ $t("defaultHardwareHead") }}</h2>
                        <div v-html="$t('indiflightHardwareText')"></div>
                    </div>
                </div>
            </div>
            <div class="content_foot">
                <div class="languageSwitcher">
                    <span>{{ $t("language_choice_message") }}</span
                    ><br />
                    <div class="language-links">
                        <a
                            v-for="lang in availableLanguages"
                            :key="lang"
                            href="#"
                            :lang="lang"
                            :class="{ selected_language: lang === selectedLanguage }"
                            @click.prevent="changeLanguage(lang)"
                        >
                            {{ $t(`language_${lang}`) }}
                        </a>
                    </div>
                </div>
            </div>
        </div>
    </BaseTab>
</template>

<script>
import { defineComponent, ref, onMounted } from "vue";
import BaseTab from "./BaseTab.vue";
import GUI from "../../js/gui";
import { i18n } from "../../js/localization";

export default defineComponent({
    name: "LandingTab",
    components: {
        BaseTab,
    },
    setup() {
        const availableLanguages = ref(["DEFAULT", ...i18n.getLanguagesAvailables()]);
        const selectedLanguage = ref(i18n.selectedLanguage);

        function changeLanguage(lang) {
            if (i18n.selectedLanguage !== lang) {
                i18n.changeLanguage(lang);
                selectedLanguage.value = lang;
            }
        }

        onMounted(() => {
            GUI.content_ready();
        });

        return {
            availableLanguages,
            selectedLanguage,
            changeLanguage,
        };
    },
});
</script>

<style lang="less">
.tab-landing {
    display: flex;
    min-height: 100%;
    background: var(--surface-100) url(../../images/pattern_light.png);
    background-size: 300px;
    overflow: hidden;
}
</style>

<style scoped lang="less">
.content_wrapper {
    display: flex;
    flex-direction: column;
    padding: 0;
    height: unset;
    overflow-y: auto;
}

.content_top {
    height: 140px;
    padding: 20px;
    margin-bottom: 15px;
}

.text1,
.text2 {
    margin-top: 15px;
    margin-bottom: 15px;
    font-weight: normal;
    font-size: 12px;
}

.content_mid {
    background-color: var(--surface-100);
    overflow: hidden;
    padding: 0 15px;
    margin-top: auto;

    h2 {
        margin-bottom: 5px;
        font-size: 13px;
    }

    h3 {
        font-size: 12px;
        margin-bottom: 5px;
    }

    :deep(.list) {
        ul {
            margin-top: 2px;
            padding-left: 20px;
            list-style: inside;
        }
        li {
            padding: 2px 0;
            list-style-type: disc;
            margin-left: 0;
            display: list-item;
        }
    }
}

.content_foot {
    clear: both;
    padding: 10px 0 5px;
}

.logowrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-left: auto;
    margin-right: auto;
    margin-top: 5px;
    color: var(--text);
    font-size: 14px;
    font-weight: 300;
    text-align: center;

    > div {
        text-align: center;
    }

    img {
        width: 600px;
        margin: 5px;
    }

    span {
        font-size: 22px;
        font-weight: 300;
    }
}

.languageSwitcher {
    margin-left: auto;
    margin-right: auto;
    text-align: center;

    .selected_language {
        font-weight: bold;
    }

    .language-links {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
    }

    a {
        font-weight: normal;
        white-space: nowrap;

        &:not(:last-child) {
            &:after {
                content: ", ";
                font-weight: normal;
            }
        }
    }
}

@media all and (max-width: 575px) {
    .logowrapper {
        width: auto;
        img {
            width: auto;
        }
    }
}

@media all and (max-width: 575px), all and (max-width: 950px) and (max-height: 500px) and (orientation: landscape) {
    .content_top {
        height: auto;
        padding: 10px 20px;
    }
    .logowrapper img {
        display: none;
    }
}
</style>
