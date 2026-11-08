/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import NoReplyMentionPlugin from "@plugins/noReplyMention";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ApplicationIntegrationType, MessageFlags } from "@vencord/discord-types/enums";
import { findByPropsLazy } from "@webpack";
import { AuthenticationStore, FluxDispatcher, MessageTypeSets, PermissionsBits, PermissionStore, WindowStore } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");
const EditStore = findByPropsLazy("isEditing", "isEditingAny");

let isEditPressed = false;
let isReplyPressed = false;
let isDeletePressed = false;

let editModifierKey = "Shift";
let replyModifierKey = "Control";
let deleteModifierKey = "Backspace";

const keydown = (e: KeyboardEvent) => {
    if(e.key === editModifierKey) isEditPressed = true;
    if(e.key === replyModifierKey) isReplyPressed = true;
    if(e.key === deleteModifierKey) isDeletePressed = true;
};

const keyup = (e: KeyboardEvent) => {
    if(e.key === editModifierKey) isEditPressed = false;
    if(e.key === replyModifierKey) isReplyPressed = false;
    if(e.key === deleteModifierKey) isDeletePressed = false;
};

const focusChanged = () => !WindowStore.isFocused() && (isDeletePressed = false); // TODO ?

const settings = definePluginSettings({
    enableDeleteOnClick: {
        type: OptionType.BOOLEAN,
        description: "Enable delete on click while holding backspace",
        default: true
    },
    deleteModifier: {
        type: OptionType.SELECT,
        description: "What modifier you would like to use to delete messages?",
        options: [
            { label: "Backspace", value: "Backspace" }
        ],
        onChange: newValue => deleteModifierKey = newValue,
        default: deleteModifierKey,
    },
    // add separator
    enableDoubleClickToEdit: {
        type: OptionType.BOOLEAN,
        description: "Enable double click to edit",
        default: true
    },
    editModifier: {
        type: OptionType.SELECT,
        description: "What modifier you would like to use to edit your own message?",
        options: [
            { label: "Shift", value: "Shift" }
        ],
        onChange: newValue => editModifierKey = newValue,
        default: editModifierKey,
    },
    enableDoubleClickToReply: {
        type: OptionType.BOOLEAN,
        description: "Enable double click to reply",
        default: true
    },
    replyModifier: {
        type: OptionType.SELECT,
        description: "What modifier you would like to use to reply to messages?",
        options: [
            { label: "Control", value: "Control" }
        ],
        onChange: newValue => replyModifierKey = newValue,
        default: replyModifierKey,
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
        if (isReplyPressed && settings.store.enableDoubleClickToReply) {
            if (numClicks < 2) return;
            if (channel.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, channel)) return;
            if (msg.deleted === true) return;

            if (!MessageTypeSets.REPLYABLE.has(msg.type) || msg.hasFlag(MessageFlags.EPHEMERAL)) return;

            const isShiftPress = event.shiftKey;
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
        if (isEditPressed && settings.store.enableDoubleClickToEdit) {
            if (numClicks < 2 || !isMe || EditStore.isEditing(channel.id, msg.id) || msg.state !== "SENT") return;

            MessageActions.startEditMessage(channel.id, msg.id, msg.content);
            event.preventDefault();

            return;
        }
        if (isDeletePressed && settings.store.enableDeleteOnClick) {
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
