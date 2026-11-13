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
import { Channel, Message } from "@vencord/discord-types";
import { ApplicationIntegrationType, MessageFlags } from "@vencord/discord-types/enums";
import { findByPropsLazy } from "@webpack";
import { AuthenticationStore, FluxDispatcher, MessageTypeSets, PermissionsBits, PermissionStore, WindowStore } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");
const EditStore = findByPropsLazy("isEditing", "isEditingAny");

let isReplyPressed = false;
let isEditPressed = false;
let isDeletePressed = false;
let clickTimeout;

const keydown = (e: KeyboardEvent) => {
    if (e.key === settings.store.replyModifier) isReplyPressed = true;
    if (e.key === settings.store.editModifier) isEditPressed = true;
    if (e.key === settings.store.deleteModifier) isDeletePressed = true;
};
const keyup = (e: KeyboardEvent) => {
    if (e.key === settings.store.replyModifier) isReplyPressed = false;
    if (e.key === settings.store.editModifier) isEditPressed = false;
    if (e.key === settings.store.deleteModifier) isDeletePressed = false;
};
const focusChanged = () => {
    if (!WindowStore.isFocused()) {
        isReplyPressed = false;
        isEditPressed = false;
        isDeletePressed = false;
    }
};

const modifierOptions = [
    { label: "None", value: "None" },
    { label: "Shift", value: "Shift" },
    { label: "Control", value: "Control" },
    { label: "Backspace", value: "Backspace" },
    { label: "Caps Lock", value: "CapsLock" },
    { label: "Alt", value: "Alt" },
];

const settings = definePluginSettings({
    actionDelay: {
        type: OptionType.SLIDER,
        description: "Time it takes after the last click to perform the action (in ms)",
        markers: makeRange(50, 1050, 100),
        stickToMarkers: false,
        default: 150,
    },
    replyHeader: {
        type: OptionType.COMPONENT,
        component: () => <Heading tag="h3">Reply Settings</Heading>
    },
    enableReplyAction: {
        type: OptionType.BOOLEAN,
        description: "Enable click to reply.",
        default: true
    },
    replyModifier: {
        type: OptionType.SELECT,
        description: "What modifier you would like to use to reply to messages",
        options: modifierOptions,
        default: "Control",
    },
    replyClickCount: {
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
    enableEditAction: {
        type: OptionType.BOOLEAN,
        description: "Enable click to edit.",
        default: true
    },
    editModifier: {
        type: OptionType.SELECT,
        description: "What modifier you would like to use to edit your own message",
        options: modifierOptions,
        default: "Shift",
    },
    editClickCount: {
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
    enableDeleteAction: {
        type: OptionType.BOOLEAN,
        description: "Enable click to delete.",
        default: true
    },
    deleteModifier: {
        type: OptionType.SELECT,
        description: "What modifier you would like to use to delete messages",
        options: modifierOptions,
        default: "Backspace",
    },
    deleteClickCount: {
        type: OptionType.SLIDER,
        description: "Number of clicks to trigger the delete feature.",
        markers: makeRange(1, 5),
        default: 1,
    }
});

const shouldReply = (editPressedSnapshot: boolean, msg: Message, channel: Channel) => {
    return (editPressedSnapshot || settings.store.replyModifier === "None") // if the modifier is being pressed
        && settings.store.enableReplyAction // is enabled
        && !msg?.deleted // isn't deleted
        && (MessageTypeSets.REPLYABLE.has(msg.type) && !msg.hasFlag(MessageFlags.EPHEMERAL)) // message is replyable
        && (!channel.guild_id || PermissionStore.can(PermissionsBits.SEND_MESSAGES, channel)); // user has permissions to reply
};
const shouldEdit = (editPressedSnapshot: boolean, msg: Message, channel: Channel, isMe: boolean) => {
    return (editPressedSnapshot || settings.store.editModifier === "None") // if the modifier is being pressed
        && settings.store.enableEditAction // is enabled
        && (isMe && !EditStore.isEditing(channel.id, msg.id) && msg.state === "SENT"); // can edit
};
const shouldDelete = (deletePressedSnapshot: boolean, msg: Message, channel: Channel, isMe: boolean, isSelfInvokedUserApp: boolean) => {
    return (deletePressedSnapshot || settings.store.deleteModifier === "None") // if the modifier is being pressed
        && settings.store.enableDeleteAction // is enabled
        && (isMe || PermissionStore.can(PermissionsBits.MANAGE_MESSAGES, channel) || isSelfInvokedUserApp); // should be able to delete
};

const replyToMessage = (msg: Message, channel: Channel, event: MouseEvent) => {
    const isShiftPress = event.shiftKey && settings.store.replyModifier !== "SHIFT"; // need shift specifically, as this is discord's default mention control
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
};

const editMessage = (isMe: boolean, msg: Message, channel: Channel, event: MouseEvent) => {
    MessageActions.startEditMessage(channel.id, msg.id, msg.content);
    event.preventDefault();
};

const deleteMessage = (isMe: boolean, msg: Message, channel: Channel, event: MouseEvent, isSelfInvokedUserApp: boolean) => {
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
};

const performActions = (msg: Message, channel: Channel, event: MouseEvent, isMe: boolean, isSelfInvokedUserApp: boolean, replyPressedSnapshot: boolean, editPressedSnapshot: boolean, deletePressedSnapshot: boolean) => {
    const numClicks = event.detail;

    if (shouldReply(replyPressedSnapshot, msg, channel) && numClicks === settings.store.replyClickCount) {
        replyToMessage(msg, channel, event);
        return;
    }
    if (shouldEdit(editPressedSnapshot, msg, channel, isMe) && numClicks === settings.store.editClickCount) {
        editMessage(isMe, msg, channel, event);
        return;
    }
    if (shouldDelete(deletePressedSnapshot, msg, channel, isMe, isSelfInvokedUserApp) && numClicks === settings.store.deleteClickCount) {
        deleteMessage(isMe, msg, channel, event, isSelfInvokedUserApp);
    }
};

export default definePlugin({
    name: "BetterMessageActions",
    description: "A fork of MessageClickActions that allows the user to choose a specific modifier for each feature. A user may click to edit their own message, reply to another message, or delete a message. The user may also choose a variety of modifiers to use.",
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
        clearTimeout(clickTimeout);
    },

    onMessageClick(msg, channel, event) {
        const myId = AuthenticationStore.getId();
        const isMe = msg.author.id === myId;
        const isSelfInvokedUserApp = msg.interactionMetadata?.authorizing_integration_owners[ApplicationIntegrationType.USER_INSTALL] === myId;

        clearTimeout(clickTimeout);

        // we take snapshots of all pressed booleans, since we care if they were pressed during the action, not during the execution
        const replyPressedSnapshot = isReplyPressed;
        const editPressedSnapshot = isEditPressed;
        const deletePressedSnapshot = isDeletePressed;
        clickTimeout = setTimeout(performActions, settings.store.actionDelay, msg, channel, event, isMe, isSelfInvokedUserApp,
            replyPressedSnapshot, editPressedSnapshot, deletePressedSnapshot);
    },
});
