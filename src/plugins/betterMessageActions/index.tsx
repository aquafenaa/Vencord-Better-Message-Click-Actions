/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { Divider } from "@components/Divider";
import { Heading } from "@components/Heading";
import NoReplyMentionPlugin from "@plugins/noReplyMention";
import { Devs } from "@utils/constants";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { ApplicationIntegrationType, MessageFlags } from "@vencord/discord-types/enums";
import { findByPropsLazy } from "@webpack";
import { AuthenticationStore, FluxDispatcher, MessageTypeSets, PermissionsBits, PermissionStore, WindowStore } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");
const EditStore = findByPropsLazy("isEditing", "isEditingAny");

let isReplyPressed = false;
let isEditPressed = false;
let isDeletePressed = false;

const keydown = (e: KeyboardEvent) => {
    if(e.key === settings.store.replyModifier) isReplyPressed = true;
    if(e.key === settings.store.editModifier) isEditPressed = true;
    if(e.key === settings.store.deleteModifier) isDeletePressed = true;
};

const keyup = (e: KeyboardEvent) => {
    if(e.key === settings.store.replyModifier) isReplyPressed = false;
    if(e.key === settings.store.editModifier) isEditPressed = false;
    if(e.key === settings.store.deleteModifier) isDeletePressed = false;
};

const focusChanged = () => {
    if (!WindowStore.isFocused()) {
        isReplyPressed = false;
        isEditPressed = false;
        isDeletePressed = false;
    }
};

const settings = definePluginSettings({
    replyHeader: {
        type: OptionType.COMPONENT,
        component: () => <Heading tag="h3">Reply Settings</Heading>
    },
    enableDoubleClickToReply: {
        type: OptionType.BOOLEAN,
        description: "Enable double click to reply",
        default: true
    },
    replyModifier: {
        type: OptionType.SELECT,
        description: "What modifier you would like to use to reply to messages",
         options: [
            { label: "Backspace", value: "Backspace" },
            { label: "Shift", value: "Shift" },
            { label: "Control", value: "Control" },
            { label: "Caps Lock", value: "CapsLock" },
            { label: "Alt", value: "Alt" },
        ],
        default: "Control",
    },
    replyClickSlider: {
        type: OptionType.SLIDER,
        description: "Number of clicks to trigger the reply feature.",
        markers: makeRange(1, 5),
        default: 2,
    },
    replyEditDivider: {
        type: OptionType.COMPONENT,
        component: () => <Divider />
    },
    editHeader: {
        type: OptionType.COMPONENT,
        component: () => <Heading tag="h3">Edit Settings</Heading>
    },
    enableDoubleClickToEdit: {
        type: OptionType.BOOLEAN,
        description: "Enable double click to edit",
        default: true
    },
    editModifier: {
        type: OptionType.SELECT,
        description: "What modifier you would like to use to edit your own message",
        options: [
            { label: "Backspace", value: "Backspace" },
            { label: "Shift", value: "Shift" },
            { label: "Control", value: "Control" },
            { label: "Caps Lock", value: "CapsLock" },
            { label: "Alt", value: "Alt" },
        ],
        default: "Shift",
    },
    editClickSlider: {
        type: OptionType.SLIDER,
        description: "Number of clicks to trigger the edit feature.",
        markers: makeRange(1, 5),
        default: 2,
    },
    editDeleteDivider: {
        type: OptionType.COMPONENT,
        component: () => <Divider />
    },
    deleteHeader: {
        type: OptionType.COMPONENT,
        component: () => <Heading tag="h3">Delete Settings</Heading>
    },
    enableDeleteOnClick: {
        type: OptionType.BOOLEAN,
        description: "Enable delete on click while holding backspace",
        default: true
    },
    deleteModifier: {
        type: OptionType.SELECT,
        description: "What modifier you would like to use to delete messages",
        options: [
            { label: "Backspace", value: "Backspace" },
            { label: "Shift", value: "Shift" },
            { label: "Control", value: "Control" },
            { label: "Caps Lock", value: "CapsLock" },
            { label: "Alt", value: "Alt" },
        ],
        default: "Backspace",
    },
    deleteClickSlider: {
        type: OptionType.SLIDER,
        description: "Number of clicks to trigger the delete feature.",
        markers: makeRange(1, 5),
        default: 1,
    }
});

export default definePlugin({
    name: "BetterMessageActions",
    description: "A fork of MessageClickActions that allows the user to choose a specific modifier for each feature",
    tags: ["Chat", "Shortcuts"],
    authors: [Devs.Ven, Devs.aquafenaa],

    settings,

    start() {
        document.addEventListener("keydown", keydown);
        document.addEventListener("keyup", keyup);
        WindowStore.addChangeListener(focusChanged);
    },

    stop() {
        document.removeEventListener("keydown", keydown);
        document.removeEventListener("keyup", keyup);
        WindowStore.removeChangeListener(focusChanged);
    },

    onMessageClick(msg, channel, event) {
        const myId = AuthenticationStore.getId();
        const isMe = msg.author.id === myId;
        const isSelfInvokedUserApp = msg.interactionMetadata?.authorizing_integration_owners[ApplicationIntegrationType.USER_INSTALL] === myId;
        const numClicks = event.detail;

        // if shift is the edit key, then we wish to prioritize reply, so the user can still reply without mentioning
        if (isReplyPressed && settings.store.enableDoubleClickToReply && numClicks >= settings.store.replyClickSlider) {
            if (channel.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, channel)) return;
            if (msg.deleted === true) return;

            if (!MessageTypeSets.REPLYABLE.has(msg.type) || msg.hasFlag(MessageFlags.EPHEMERAL)) return;

            const isShiftPress = event.shiftKey; // need shift specifically, as this is discord's default mention control
            const shouldMention = isPluginEnabled(NoReplyMentionPlugin.name)
                ? NoReplyMentionPlugin.shouldMention(msg, isShiftPress)
                : !isShiftPress;

            FluxDispatcher.dispatch({
                type: "CREATE_PENDING_REPLY",
                channel,
                message: msg,
                shouldMention,
                showMentionToggle: channel.guild_id !== null
            });

            return;
        }
        if (isEditPressed && settings.store.enableDoubleClickToEdit && numClicks >= settings.store.editClickSlider) {
            if (!isMe || EditStore.isEditing(channel.id, msg.id) || msg.state !== "SENT") return;

            MessageActions.startEditMessage(channel.id, msg.id, msg.content);
            event.preventDefault();

            return;
        }
        if (isDeletePressed && settings.store.enableDeleteOnClick && numClicks >= settings.store.deleteClickSlider) {
            if (!isMe && !PermissionStore.can(PermissionsBits.MANAGE_MESSAGES, channel) && !isSelfInvokedUserApp) return;

            if (msg.deleted) {
                FluxDispatcher.dispatch({
                    type: "MESSAGE_DELETE",
                    channelId: channel.id,
                    id: msg.id,
                    mlDeleted: true
                });
            } else {
                MessageActions.deleteMessage(channel.id, msg.id);
            }
            event.preventDefault();
        }
    },
});
