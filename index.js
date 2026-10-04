'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// ✦ VELNO — Sovereign Edition
//   Music · Economy · Moderation · Leveling · Tickets · Utility · Fun · Owner
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const http = require('http');
const {
    Client, GatewayIntentBits, Partials, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, StringSelectMenuBuilder, PermissionsBitField, REST, Routes, ChannelType,
    ActivityType, MessageFlags, version: DJS_VERSION
} = require('discord.js');
const mongoose = require('mongoose');
const {
    joinVoiceChannel, createAudioPlayer, createAudioResource,
    AudioPlayerStatus, VoiceConnectionStatus, entersState
} = require('@discordjs/voice');
const play = require('play-dl');

// ─── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
    TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    MONGO_URI: process.env.MONGODB_URI || process.env.MONGO_URI,
    PREFIX: '.'
};
const OWNER_IDS = (process.env.OWNER_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const isOwner = id => OWNER_IDS.includes(String(id));
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const STARTED_AT = Date.now();

const THEME = {
    GOLD: '#241847',
    ERROR: '#DC2626',
    SUCCESS: '#10b967',
    WARNING: '#9e6611',
    FOOTER: '✦ Velno • Engineered with purpose.'
};

// Symbols (monochrome on every platform — no emoji)
const SYM = { star: '✦', arrow: '❯', ok: '✓', no: '✕', dot: '·', coin: '◈' };

const CATEGORIES = {
    music:      { name: 'Music',      icon: '♪', desc: 'Stream tracks, manage the queue and control voice.' },
    economy:    { name: 'Economy',    icon: '◈', desc: 'Earn, bank, gamble and shop.' },
    moderation: { name: 'Moderation', icon: '❖', desc: 'Keep your server safe and tidy.' },
    leveling:   { name: 'Leveling',   icon: '▲', desc: 'XP, ranks and level rewards.' },
    tickets:    { name: 'Tickets',    icon: '◇', desc: 'Private support channels.' },
    utility:    { name: 'Utility',    icon: '✧', desc: 'Info, profiles and handy tools.' },
    fun:        { name: 'Fun',        icon: '✺', desc: 'Games, polls, reminders and more.' },
    server:     { name: 'Server',     icon: '☰', desc: 'Per-server settings and setup.' },
    owner:      { name: 'Owner',      icon: '✪', desc: 'Restricted to the bot owner.' }
};

// ─── Error tracking ──────────────────────────────────────────────────────────
const recentErrors = [];
function logError(where, err) {
    console.error(`[${where}]`, err);
    recentErrors.push({ at: Date.now(), where, msg: String(err?.message || err).slice(0, 200) });
    if (recentErrors.length > 8) recentErrors.shift();
}
process.on('unhandledRejection', e => logError('unhandledRejection', e));
process.on('uncaughtException', e => logError('uncaughtException', e));

// ─── Small utilities ─────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const stripBrackets = s => String(s ?? '').replace(/[\[\]]/g, '');
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const fmt = n => Math.floor(n).toLocaleString('en-US');
const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const prettify = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2');
const unique = arr => [...new Set(arr)];

function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

function fmtDuration(sec) {
    if (!sec) return 'Live';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtMs(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, (sec || !(d || h || m)) && `${sec}s`].filter(Boolean).join(' ');
}

// "10m", "1h30m", "2d", "45" (defaults to minutes) → milliseconds, or null
function parseDuration(input) {
    if (!input) return null;
    let str = String(input).toLowerCase().replace(/\s+/g, '')
        .replace(/weeks?/g, 'w').replace(/days?/g, 'd').replace(/hours?|hrs?/g, 'h')
        .replace(/minutes?|mins?/g, 'm').replace(/seconds?|secs?/g, 's');
    if (/^\d+(\.\d+)?$/.test(str)) str += 'm';
    if (!/^(\d+(\.\d+)?[wdhms])+$/.test(str)) return null;
    const mult = { w: 604800000, d: 86400000, h: 3600000, m: 60000, s: 1000 };
    let total = 0;
    for (const [, n, u] of str.matchAll(/(\d+(?:\.\d+)?)([wdhms])/g)) total += parseFloat(n) * mult[u];
    return total > 0 ? Math.floor(total) : null;
}

// "500", "1.5k", "2m", "all", "half" → integer, or null
function parseAmount(raw, max) {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).toLowerCase().replace(/,/g, '');
    if (s === 'all' || s === 'max') return max;
    if (s === 'half') return Math.floor(max / 2);
    const m = s.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
    if (!m) return null;
    return Math.floor(parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1));
}

function progressBar(ratio, len = 14) {
    const f = Math.max(0, Math.min(len, Math.round(ratio * len)));
    return '▬'.repeat(f) + '●' + '─'.repeat(len - f);
}

function createEmbed(title, description, color = THEME.GOLD) {
    const e = new EmbedBuilder().setColor(color).setTimestamp()
        .setFooter({ text: THEME.FOOTER, iconURL: client?.user?.displayAvatarURL() });
    if (title) e.setTitle(title);
    if (description) e.setDescription(clip(description, 4000));
    return e;
}

// ─── Vinyl GIFs: pre-made files, no image processing inside the bot ─────────
// Either set VINYL_SPIN_URL / VINYL_STILL_URL to any hosted GIF links, or put
// vinyl-spin.gif and vinyl-still.gif in an "assets" folder next to index.js.
const fs = require('fs');
const path = require('path');
const ASSET_DIR = path.join(__dirname, 'assets');
const assetCache = new Map();
function readAsset(name) {
    if (assetCache.has(name)) return assetCache.get(name);
    let buf = null;
    try { buf = fs.readFileSync(path.join(ASSET_DIR, name)); } catch {}
    assetCache.set(name, buf);
    return buf;
}

// Tiny web server (Render needs an open port). Also serves the two static GIFs.
http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    const m = url.match(/^\/assets\/(vinyl-spin|vinyl-still)\.gif$/);
    const buf = m ? readAsset(`${m[1]}.gif`) : null;
    if (buf) {
        res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'public, max-age=604800' });
        return res.end(buf);
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Velno is online');
}).listen(process.env.PORT || 3000);

function vinylUrl(paused) {
    const override = paused ? process.env.VINYL_STILL_URL : process.env.VINYL_SPIN_URL;
    if (override) return override;
    const file = paused ? 'vinyl-still.gif' : 'vinyl-spin.gif';
    if (PUBLIC_URL && readAsset(file)) return `${PUBLIC_URL}/assets/${file}`;
    return null;
}

// ─── Database ────────────────────────────────────────────────────────────────
const { Schema } = mongoose;

const memberSchema = new Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    balance: { type: Number, default: 1000 },
    bank: { type: Number, default: 0 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    dailyStreak: { type: Number, default: 0 },
    lastDaily: Date,
    lastWork: Date,
    inventory: [String]
});
memberSchema.index({ guildId: 1, userId: 1 }, { unique: true });
const Member = mongoose.model('VelnoMember', memberSchema);

const configSchema = new Schema({
    guildId: { type: String, required: true, unique: true },
    prefix: { type: String, default: '.' },
    modLogChannel: String,
    welcomeChannel: String,
    welcomeMessage: { type: String, default: 'Welcome {user} to **{server}**! You are member #{count}.' },
    goodbyeChannel: String,
    autoRole: String,
    ticketStaffRole: String,
    levelMessages: { type: Boolean, default: true },
    levelRoles: [{ level: Number, roleId: String }]
});
const GuildConfig = mongoose.model('VelnoGuildConfig', configSchema);

const Warning = mongoose.model('VelnoWarning', new Schema({
    guildId: String, userId: String, moderatorId: String, reason: String, createdAt: { type: Date, default: Date.now }
}));

const Playlist = mongoose.model('VelnoPlaylist', new Schema({
    userId: String, name: String,
    tracks: [{ title: String, url: String, search: String, duration: String, durationSec: Number, thumbnail: String }]
}));

const Reminder = mongoose.model('VelnoReminder', new Schema({
    userId: String, channelId: String, text: String, at: Date
}));

const Settings = mongoose.model('VelnoSettings', new Schema({
    key: { type: String, default: 'main', unique: true },
    maintenance: { type: Boolean, default: false },
    blacklistUsers: [String],
    blacklistGuilds: [String],
    status: { type: String, default: 'online' },
    activityType: { type: String, default: 'watching' },
    activityText: { type: String, default: 'over the Empire | .help' }
}));

let botSettings = { maintenance: false, blacklistUsers: [], blacklistGuilds: [], status: 'online', activityType: 'watching', activityText: 'over the Empire | .help' };
async function loadSettings() {
    const doc = await Settings.findOneAndUpdate({ key: 'main' }, { $setOnInsert: { maintenance: false } }, { upsert: true, new: true }).lean();
    botSettings = { ...botSettings, ...doc };
}
async function saveSettings(patch) {
    Object.assign(botSettings, patch);
    await Settings.updateOne({ key: 'main' }, { $set: patch }, { upsert: true });
}

async function getMember(guildId, userId) {
    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
    try { return await Member.findOneAndUpdate({ guildId, userId }, { $setOnInsert: { dailyStreak: 0 } }, opts); }
    catch (e) { if (e.code === 11000) return Member.findOne({ guildId, userId }); throw e; }
}

const configCache = new Map();
async function getConfig(guildId) {
    if (configCache.has(guildId)) return configCache.get(guildId);
    const doc = await GuildConfig.findOneAndUpdate({ guildId }, { $setOnInsert: { levelMessages: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    configCache.set(guildId, doc);
    return doc;
}
async function updateConfig(guildId, patch) {
    const doc = await GuildConfig.findOneAndUpdate({ guildId }, { $set: patch },
        { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    configCache.set(guildId, doc);
    return doc;
}

// Leveling math (MEE6-style curve). xp = progress inside the current level.
const xpFor = level => 5 * level * level + 50 * level + 100;

// ─── Client ──────────────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND FRAMEWORK — every command works as both `.prefix` and `/slash`
// ═══════════════════════════════════════════════════════════════════════════════

const commands = [];
const commandMap = new Map(); // name + aliases → command

function defineCommand(def) {
    def.aliases = def.aliases || [];
    def.options = def.options || [];
    def.category = def.category || 'utility';
    if (def.category === 'owner') { def.ownerOnly = true; def.hidden = true; def.slash = false; }
    commands.push(def);
    commandMap.set(def.name, def);
    for (const a of def.aliases) commandMap.set(a, def);
}

class UsageError extends Error {}

const OPT_TYPE = { string: 3, integer: 4, boolean: 5, user: 6, channel: 7, role: 8, number: 10 };
const VOICE_ONLY = [ChannelType.GuildVoice];

function usageOf(cmd, prefix = CONFIG.PREFIX) {
    const parts = cmd.options.filter(o => !o.slashOnly).map(o => (o.required ? `<${o.name}>` : `[${o.name}]`));
    return `${prefix}${cmd.name}${parts.length ? ' ' + parts.join(' ') : ''}`;
}

function permLabel(p) { return prettify(typeof p === 'string' ? p : String(p)); }

function choicesText(def) {
    return def.choices.map(c => `\`${typeof c === 'string' ? c : c.value}\``).join(', ');
}

// ─── Prefix option parsing ───────────────────────────────────────────────────
async function coerceOption(def, raw, guild, author) {
    if (def.allowOff && /^(off|none|disable|disabled)$/i.test(raw)) return 'off';
    switch (def.type) {
        case 'string': {
            if (def.choices) {
                const values = def.choices.map(c => (typeof c === 'string' ? c : c.value));
                return values.find(v => String(v).toLowerCase() === raw.toLowerCase());
            }
            return raw;
        }
        case 'integer': return /^-?\d+$/.test(raw) ? parseInt(raw, 10) : undefined;
        case 'number': { const n = Number(raw); return Number.isFinite(n) ? n : undefined; }
        case 'boolean':
            if (/^(true|yes|on|y|1|enable|enabled)$/i.test(raw)) return true;
            if (/^(false|no|off|n|0|disable|disabled)$/i.test(raw)) return false;
            return undefined;
        case 'user': {
            if (/^(me|myself)$/i.test(raw)) return author;
            const id = (raw.match(/^<@!?(\d{15,25})>$/) || raw.match(/^(\d{15,25})$/) || [])[1];
            if (id) return client.users.fetch(id).catch(() => undefined);
            const q = raw.replace(/^@/, '').toLowerCase();
            const m = guild.members.cache.find(x => x.user.username.toLowerCase() === q || x.displayName.toLowerCase() === q);
            return m?.user;
        }
        case 'channel': {
            const id = (raw.match(/^<#(\d{15,25})>$/) || raw.match(/^(\d{15,25})$/) || [])[1];
            const q = raw.replace(/^#/, '').toLowerCase();
            const ok = c => !def.channelTypes || def.channelTypes.includes(c.type);
            const ch = id ? guild.channels.cache.get(id) : guild.channels.cache.find(c => ok(c) && c.name.toLowerCase() === q);
            return ch && ok(ch) ? ch : undefined;
        }
        case 'role': {
            const id = (raw.match(/^<@&(\d{15,25})>$/) || raw.match(/^(\d{15,25})$/) || [])[1];
            const q = raw.replace(/^@/, '').toLowerCase();
            return id ? guild.roles.cache.get(id) : guild.roles.cache.find(r => r.name.toLowerCase() === q);
        }
    }
    return undefined;
}

async function parsePrefixOptions(cmd, args, message) {
    const opts = {};
    const defs = cmd.options.filter(o => !o.slashOnly);
    let idx = 0;
    for (let n = 0; n < defs.length; n++) {
        const def = defs[n];
        const greedy = (def.rest || n === defs.length - 1) && ['string', 'channel', 'role'].includes(def.type);
        let raw;
        if (greedy) { raw = args.slice(idx).join(' '); idx = args.length; } else raw = args[idx++];
        if (raw === undefined || raw === '') {
            if (def.required) throw new UsageError(`Missing **${def.name}**.`);
            continue;
        }
        const val = await coerceOption(def, raw, message.guild, message.author);
        if (val === undefined || val === null) {
            throw new UsageError(`Invalid **${def.name}**${def.choices ? ` — choose ${choicesText(def)}` : ''}.`);
        }
        opts[def.name] = val;
    }
    return opts;
}

// ─── Slash option reading + registration JSON ────────────────────────────────
function readSlashOptions(cmd, i) {
    const o = {}, g = i.options;
    for (const def of cmd.options) {
        let v = null;
        switch (def.type) {
            case 'string': v = g.getString(def.name); break;
            case 'integer': v = g.getInteger(def.name); break;
            case 'number': v = g.getNumber(def.name); break;
            case 'boolean': v = g.getBoolean(def.name); break;
            case 'user': v = g.getUser(def.name); break;
            case 'channel': v = g.getChannel(def.name); break;
            case 'role': v = g.getRole(def.name); break;
        }
        if (v !== null && v !== undefined) o[def.name] = v;
    }
    return o;
}

function toSlashJson(cmd) {
    const sorted = cmd.options.slice().sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));
    return {
        name: cmd.name,
        description: clip(cmd.description, 100),
        dm_permission: false,
        options: sorted.map(o => {
            const j = { type: OPT_TYPE[o.type], name: o.name, description: clip(o.description || o.name, 100), required: !!o.required };
            if (o.choices && ['string', 'integer', 'number'].includes(o.type)) {
                j.choices = o.choices.map(c => (typeof c === 'string' ? { name: c, value: c } : c));
            }
            if (o.channelTypes && o.type === 'channel') j.channel_types = o.channelTypes;
            return j;
        })
    };
}

// ─── Context: one object that hides the slash/prefix differences ─────────────
class Ctx {
    constructor(source, isSlash, cmd, opts, prefix) {
        this.source = source; this.isSlash = isSlash; this.cmd = cmd;
        this.opts = opts || {}; this.prefix = prefix || CONFIG.PREFIX;
    }
    get guild() { return this.source.guild; }
    get channel() { return this.source.channel; }
    get member() { return this.source.member; }
    get user() { return this.isSlash ? this.source.user : this.source.author; }
    get isOwner() { return isOwner(this.user.id); }

    async defer() {
        if (this.isSlash) {
            if (!this.source.deferred && !this.source.replied) await this.source.deferReply();
        } else {
            await this.channel.sendTyping().catch(() => {});
        }
    }

    async reply(content, { ephemeral = false, fetch = false } = {}) {
        const payload = typeof content === 'string' ? { content } : { ...content };
        if (!payload.allowedMentions) payload.allowedMentions = { parse: [], repliedUser: false };
        if (this.isSlash) {
            const i = this.source;
            if (i.deferred && !i.replied) { delete payload.flags; return i.editReply(payload); }
            if (ephemeral) payload.flags = MessageFlags.Ephemeral;
            if (i.replied || i.deferred) return i.followUp(payload);
            await i.reply(payload);
            return fetch ? i.fetchReply() : null;
        }
        const sent = await this.channel.send({ ...payload, reply: { messageReference: this.source.id, failIfNotExists: false } });
        if (ephemeral) setTimeout(() => sent.delete().catch(() => {}), 6000);
        return sent;
    }

    ok(text, o) { return this.reply({ embeds: [createEmbed(null, `${SYM.ok}  ${text}`, THEME.SUCCESS)] }, o); }
    fail(text, o) { return this.reply({ embeds: [createEmbed(null, `${SYM.no}  ${text}`, THEME.ERROR)] }, o); }
    note(text, o) { return this.reply({ embeds: [createEmbed(null, `${SYM.star}  ${text}`)] }, o); }
    usage(msg) {
        const c = this.cmd;
        let d = `**Usage**\n\`${usageOf(c, this.prefix)}\``;
        if (c.example) d += `\n**Example**\n\`${c.example}\``;
        return this.reply({ embeds: [createEmbed(`${SYM.no}  ${msg.replace(/\*\*/g, '')}`, d, THEME.ERROR)] }, { ephemeral: true });
    }
}

// ─── Guards + dispatcher ─────────────────────────────────────────────────────
const cooldowns = new Map();

async function checkGuards(cmd, ctx) {
    const owner = ctx.isOwner;
    if (cmd.ownerOnly && !owner) return { silent: true };
    if (!owner) {
        if (botSettings.blacklistUsers.includes(ctx.user.id) || botSettings.blacklistGuilds.includes(ctx.guild.id)) return { silent: true };
        if (botSettings.maintenance) return { msg: 'The bot is in maintenance mode. Please try again soon.' };
    }
    if (cmd.userPerms?.length && !owner && !ctx.member.permissions.has(cmd.userPerms)) {
        return { msg: `You need the **${cmd.userPerms.map(permLabel).join(', ')}** permission.` };
    }
    if (cmd.botPerms?.length && !ctx.guild.members.me.permissions.has(cmd.botPerms)) {
        return { msg: `I need the **${cmd.botPerms.map(permLabel).join(', ')}** permission for that.` };
    }
    let cooldownKey = null;
    if (cmd.cooldown && !owner) {
        const key = `${cmd.name}:${ctx.user.id}`, until = cooldowns.get(key) || 0;
        if (Date.now() < until) return { msg: `Slow down — try again in **${((until - Date.now()) / 1000).toFixed(1)}s**.` };
        cooldownKey = key;
    }
    if (cmd.needsPlayer && !music.get(ctx.guild.id)) return { msg: 'Nothing is playing right now.' };
    const botVC = ctx.guild.members.me?.voice?.channelId, userVC = ctx.member.voice?.channelId;
    if (cmd.vc && !userVC) return { msg: 'Join a voice channel first.' };
    if (cmd.sameVC && botVC && userVC !== botVC) return { msg: `Join <#${botVC}> to use this.` };
    if (cooldownKey) cooldowns.set(cooldownKey, Date.now() + cmd.cooldown * 1000);   // only start the cooldown once the command really runs
    return null;
}

async function executeCommand(cmd, ctx) {
    try {
        const blocked = await checkGuards(cmd, ctx);
        if (blocked) { if (!blocked.silent) await ctx.fail(blocked.msg, { ephemeral: true }); return; }
        if (cmd.defer) await ctx.defer();
        await cmd.execute(ctx);
    } catch (err) {
        if (err instanceof UsageError) return ctx.usage(err.message).catch(() => {});
        logError(`command:${cmd.name}`, err);
        await ctx.fail(`Something went wrong: ${clip(err.message, 200)}`).catch(() => {});
    }
}

// ─── Shared moderation helpers ───────────────────────────────────────────────
function hierarchyError(ctx, target) {
    if (!target) return null;
    const g = ctx.guild, me = g.members.me;
    if (target.id === ctx.user.id) return "You can't do that to yourself.";
    if (target.id === client.user.id) return "I can't do that to myself.";
    if (target.id === g.ownerId) return "That's the server owner.";
    if (ctx.user.id !== g.ownerId && !ctx.isOwner && target.roles.highest.position >= ctx.member.roles.highest.position) {
        return 'Their highest role is equal to or above yours.';
    }
    if (target.roles.highest.position >= me.roles.highest.position) return "Their highest role is above mine, so I can't act on them.";
    return null;
}

async function modLog(guild, embed) {
    try {
        const cfg = await getConfig(guild.id);
        if (!cfg.modLogChannel) return;
        const ch = guild.channels.cache.get(cfg.modLogChannel);
        if (ch?.isTextBased()) await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (e) { logError('modlog', e); }
}

function actionEmbed(title, color, target, moderator, reason, extra = []) {
    const e = createEmbed(title, null, color).addFields(
        { name: 'User', value: `${target.tag ?? target.username} (${target.id})`, inline: true },
        { name: 'Moderator', value: `${moderator.username} (${moderator.id})`, inline: true },
        ...extra,
        { name: 'Reason', value: clip(reason || 'No reason provided', 1000) }
    );
    return e;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MUSIC ENGINE — SoundCloud first, YouTube fallback, optional Spotify links
// ═══════════════════════════════════════════════════════════════════════════════

const music = new Map();          // guildId → state
const stateCreation = new Map();  // guildId → Promise (prevents double joins)
let scReady = false, spotifyTried = false, spotifyEnabled = false;
const LOOP_LABEL = { off: 'Off', track: 'Track', queue: 'Queue' };
const IDLE_LEAVE_MS = 2 * 60 * 1000;

async function initMusic() {
    if (!scReady) {
        try {
            const id = await play.getFreeClientID();
            await play.setToken({ soundcloud: { client_id: id } });
            scReady = true;
            console.log('🎵 SoundCloud ready');
        } catch (err) { console.error('❌ SoundCloud init failed:', err.message); }
    }
    if (!spotifyTried) {
        spotifyTried = true;
        if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_REFRESH_TOKEN) {
            try {
                await play.setToken({
                    spotify: {
                        client_id: process.env.SPOTIFY_CLIENT_ID,
                        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
                        refresh_token: process.env.SPOTIFY_REFRESH_TOKEN,
                        market: process.env.SPOTIFY_MARKET || 'US'
                    }
                });
                spotifyEnabled = true;
                console.log('🎵 Spotify links ready');
            } catch (err) { console.error('❌ Spotify init failed:', err.message); }
        }
    }
}

const sourceOf = url => (/soundcloud\.com/.test(url || '') ? 'SoundCloud' : /youtu/.test(url || '') ? 'YouTube' : 'Stream');
const thumbOf = r => (typeof r.thumbnail === 'string' ? r.thumbnail : r.thumbnail?.url) || r.thumbnails?.[0]?.url || null;

function songFrom(r, requester) {
    const sec = r.durationInSec || 0;
    return { title: r.name || r.title || 'Unknown', url: r.url, duration: fmtDuration(sec), durationSec: sec, thumbnail: thumbOf(r), requester };
}

async function searchOne(query) {
    let results = await play.search(query, { source: { soundcloud: 'tracks' }, limit: 1 }).catch(() => []);
    if (!results.length) results = await play.search(query, { limit: 1 }).catch(() => []);
    return results[0] || null;
}

async function resolveTracks(query, requester) {
    await initMusic();
    const type = await play.validate(query);
    if (type === false) throw new Error('That link is not supported.');

    if (type === 'search') {
        const r = await searchOne(query);
        return r ? [songFrom(r, requester)] : [];
    }
    if (type === 'so_track') return [songFrom(await play.soundcloud(query), requester)];
    if (type === 'so_playlist') {
        const tracks = await (await play.soundcloud(query)).all_tracks();
        return tracks.slice(0, 50).map(t => songFrom(t, requester));
    }
    if (type === 'sp_track' || type === 'sp_album' || type === 'sp_playlist') {
        if (!spotifyEnabled) throw new Error('Spotify links are not set up on this bot. Use a song name or a SoundCloud link.');
        if (play.is_expired()) await play.refreshToken();
        const toSong = t => {
            const artist = t.artists?.[0]?.name || '';
            return {
                title: artist ? `${artist} - ${t.name}` : t.name, url: null, search: `${artist} ${t.name}`.trim(),
                duration: fmtDuration(t.durationInSec), durationSec: t.durationInSec || 0, thumbnail: t.thumbnail?.url || null, requester
            };
        };
        const sp = await play.spotify(query);
        if (type === 'sp_track') return [toSong(sp)];
        return (await sp.all_tracks()).slice(0, 50).map(toSong);
    }
    if (type === 'yt_video') return [songFrom((await play.video_basic_info(query)).video_details, requester)];
    throw new Error('That link type is not supported. Use a song name, SoundCloud link or Spotify link.');
}

async function ensurePlayable(song) {
    if (song.url) return;
    const r = await searchOne(song.search || song.title);
    if (!r) throw new Error(`No playable match for "${song.title}"`);
    song.url = r.url;
}

// ─── State helpers ───────────────────────────────────────────────────────────
function clearTimers(state) {
    for (const k of ['pauseTimer', 'idleTimer', 'aloneTimer']) { if (state[k]) { clearTimeout(state[k]); state[k] = null; } }
}
const botVoiceChannel = guild => guild.members.me?.voice?.channel || null;
const humansIn = ch => (ch ? ch.members.filter(m => !m.user.bot).size : 0);
const elapsedMs = s => (s.startedAt ? Math.max(0, (s.pausedAt ?? Date.now()) - s.startedAt - s.pausedTotal) : 0);

function cleanupMusic(guildId) {
    const state = music.get(guildId);
    if (!state) return;
    music.delete(guildId);          // delete first so listeners below become no-ops
    clearTimers(state);
    retireNowMessage(state);
    try { state.player.stop(true); } catch {}
    try { state.connection.destroy(); } catch {}
}

async function ensureState(guild, voiceChannel, textChannel) {
    const gid = guild.id;
    if (music.has(gid)) return music.get(gid);
    if (stateCreation.has(gid)) return stateCreation.get(gid);

    const creating = (async () => {
        const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: gid, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
        try { await entersState(connection, VoiceConnectionStatus.Ready, 20_000); }
        catch {
            try { connection.destroy(); } catch {}
            throw new Error('Could not join the voice channel (check my Connect and Speak permissions).');
        }
        const player = createAudioPlayer();
        connection.subscribe(player);

        const state = {
            guildId: gid, queue: [], history: [], player, connection, textChannel, token: 0,
            loop: 'off', action: null, paused: false, votes: new Set(), stay: false,
            nowMessage: null, nowSong: null, startedAt: 0, pausedAt: null, pausedTotal: 0,
            pauseTimer: null, idleTimer: null, aloneTimer: null
        };
        music.set(gid, state);

        player.on(AudioPlayerStatus.Idle, () => {
            if (music.get(gid) !== state) return;
            const action = state.action; state.action = null;
            advanceQueue(state, action);
            playNext(gid);
        });
        player.on('error', err => logError('audio-player', err));

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
                ]);
            } catch { cleanupMusic(gid); }
        });
        return state;
    })().finally(() => stateCreation.delete(gid));

    stateCreation.set(gid, creating);
    return creating;
}

// Decides what the queue looks like after the current track ends / is skipped
function advanceQueue(state, action) {
    const current = state.queue[0];
    if (!current) return;
    if (action === 'previous' && state.history.length) { state.queue.unshift(state.history.pop()); return; }
    if (state.loop === 'track' && action !== 'skip') return;   // same track repeats
    state.queue.shift();
    state.history.push(current);
    if (state.history.length > 25) state.history.shift();
    if (state.loop === 'queue') state.queue.push(current);
}

// ─── Now-playing embed + controls ────────────────────────────────────────────
function buildNowPlaying(state, song, { finished = false } = {}) {
    const paused = state.paused && !finished;
    const e = createEmbed(finished ? `${SYM.star}  Played` : paused ? '❚❚  Paused' : `${SYM.star}  Now Playing`,
        `[**${stripBrackets(clip(song.title, 200))}**](${song.url})`);
    e.addFields(
        { name: 'Duration', value: song.duration || 'Live', inline: true },
        { name: 'Requested by', value: clip(song.requester || 'Unknown', 100), inline: true },
        { name: 'Source', value: sourceOf(song.url), inline: true }
    );
    if (!finished) {
        e.addFields(
            { name: 'Loop', value: LOOP_LABEL[state.loop], inline: true },
            { name: 'Up next', value: String(Math.max(0, state.queue.length - 1)), inline: true }
        );
    }
    if (song.thumbnail) e.setThumbnail(song.thumbnail);
    const v = vinylUrl(paused || finished);
    if (v) e.setImage(v);
    return e;
}

function buildPlayerButtons(state) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('np:pause').setLabel(state.paused ? '►' : '❚❚').setStyle(state.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('np:skip').setLabel('»').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('np:stop').setLabel('■').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('np:loop').setLabel(`↻ ${LOOP_LABEL[state.loop]}`).setStyle(state.loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Primary)
    )];
}

function refreshNowPlaying(state) {
    if (!state.nowMessage || !state.nowSong) return;
    state.nowMessage.edit({ embeds: [buildNowPlaying(state, state.nowSong)], components: buildPlayerButtons(state) }).catch(() => {});
}

async function retireNowMessage(state) {
    const msg = state.nowMessage, song = state.nowSong;
    state.nowMessage = null;
    if (msg && song) await msg.edit({ embeds: [buildNowPlaying(state, song, { finished: true })], components: [] }).catch(() => {});
}

async function announceNowPlaying(state, song) {
    if (state.nowMessage && state.nowSong === song) { refreshNowPlaying(state); return; }   // track loop
    await retireNowMessage(state);
    state.nowSong = song;
    state.nowMessage = await state.textChannel.send({ embeds: [buildNowPlaying(state, song)], components: buildPlayerButtons(state) }).catch(() => null);
}

// ─── Playback ────────────────────────────────────────────────────────────────
async function onQueueEnd(state) {
    await retireNowMessage(state);
    state.nowSong = null; state.startedAt = 0; state.paused = false; state.pausedAt = null;
    if (state.stay) return;
    state.textChannel.send({ embeds: [createEmbed(null, `${SYM.star}  Queue finished. I'll leave in 2 minutes unless you queue something.`)] }).catch(() => {});
    scheduleIdleLeave(state);
}

function scheduleIdleLeave(state) {
    if (state.idleTimer) clearTimeout(state.idleTimer);
    if (state.stay) return;
    state.idleTimer = setTimeout(() => {
        if (music.get(state.guildId) === state && state.queue.length === 0) cleanupMusic(state.guildId);
    }, IDLE_LEAVE_MS);
}

async function playNext(gid) {
    const state = music.get(gid);
    if (!state) return;
    const song = state.queue[0];
    if (!song) return onQueueEnd(state);

    if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
    const token = ++state.token;
    state.votes.clear();
    try {
        await ensurePlayable(song);
        const stream = await play.stream(song.url);
        if (state.token !== token || music.get(gid) !== state) return;      // skipped or stopped while loading
        state.player.play(createAudioResource(stream.stream, { inputType: stream.type }));
        state.paused = false; state.pausedAt = null; state.pausedTotal = 0; state.startedAt = Date.now();
        if (state.pauseTimer) { clearTimeout(state.pauseTimer); state.pauseTimer = null; }
        await announceNowPlaying(state, song);
    } catch (err) {
        logError('stream', err);
        if (state.token !== token) return;
        state.textChannel.send({ embeds: [createEmbed(null, `${SYM.no}  Couldn't play **${stripBrackets(clip(song.title, 100))}** — ${clip(err.message, 120)}. Skipping…`, THEME.ERROR)] }).catch(() => {});
        state.queue.shift();
        playNext(gid);
    }
}

// ─── Controls shared by commands and buttons ─────────────────────────────────
function pauseTrack(state) {
    if (state.paused || !state.queue.length) return false;
    if (!state.player.pause(true)) return false;
    state.paused = true; state.pausedAt = Date.now();
    clearTimeout(state.pauseTimer);
    state.pauseTimer = setTimeout(() => {
        if (music.get(state.guildId) !== state || !state.paused) return;
        state.textChannel.send({ embeds: [createEmbed(null, `${SYM.star}  Paused for too long — leaving the channel.`)] }).catch(() => {});
        cleanupMusic(state.guildId);
    }, 10 * 60 * 1000);
    refreshNowPlaying(state);
    return true;
}

function resumeTrack(state) {
    if (!state.paused) return false;
    if (!state.player.unpause()) return false;
    state.pausedTotal += Date.now() - (state.pausedAt || Date.now());
    state.paused = false; state.pausedAt = null;
    clearTimeout(state.pauseTimer); state.pauseTimer = null;
    refreshNowPlaying(state);
    return true;
}

function skipTrack(state, action = 'skip') {
    if (!state.queue.length) return false;
    if (state.pauseTimer) { clearTimeout(state.pauseTimer); state.pauseTimer = null; }
    state.paused = false; state.pausedAt = null;
    if (state.player.state.status === AudioPlayerStatus.Idle) { advanceQueue(state, action); playNext(state.guildId); }   // still loading
    else { state.action = action; state.player.stop(true); }
    return true;
}

function stopPlayback(state) {
    state.queue.length = 0; state.paused = false; state.pausedAt = null;
    if (state.pauseTimer) { clearTimeout(state.pauseTimer); state.pauseTimer = null; }
    state.token++;                                           // cancels anything still loading
    if (state.player.state.status === AudioPlayerStatus.Idle) onQueueEnd(state);
    else { state.action = 'stop'; state.player.stop(true); }
}

function setLoop(state, mode) {
    state.loop = mode;
    refreshNowPlaying(state);
}

async function moveBot(state, guild, target) {
    joinVoiceChannel({ channelId: target.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
    await sleep(800);
    await entersState(state.connection, VoiceConnectionStatus.Ready, 15_000);
}

function queueSummary(state) {
    const total = state.queue.reduce((a, s) => a + (s.durationSec || 0), 0);
    return { count: state.queue.length, total };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS — MUSIC & VOICE
// ═══════════════════════════════════════════════════════════════════════════════

const sleepTimers = new Map();   // `${guildId}:${userId}` → timeout

defineCommand({
    name: 'play', aliases: ['p'], category: 'music', description: 'Play a song, SoundCloud/Spotify link or playlist',
    options: [{ name: 'query', type: 'string', description: 'Song name or link', required: false }],
    vc: true, sameVC: true, defer: true, cooldown: 2, example: '.play lofi hip hop',
    async execute(ctx) {
        const vc = ctx.member.voice.channel;
        let state = music.get(ctx.guild.id);
        const query = ctx.opts.query;
        if (!query) {
            if (state?.paused && resumeTrack(state)) return ctx.ok('Resumed.');
            return ctx.fail(`Tell me what to play: \`${ctx.prefix}play <song or link>\``);
        }
        if (!vc.permissionsFor(ctx.guild.members.me).has(['ViewChannel', 'Connect', 'Speak'])) {
            return ctx.fail(`I need **Connect** and **Speak** permission in ${vc}.`);
        }
        if (state && state.queue.length >= 200) return ctx.fail('The queue is full (200 tracks).');

        let tracks;
        try { tracks = await resolveTracks(query, ctx.user.username); } catch (e) { return ctx.fail(e.message); }
        if (!tracks.length) return ctx.fail('No results found.');
        try { state = await ensureState(ctx.guild, vc, ctx.channel); } catch (e) { return ctx.fail(e.message); }

        state.textChannel = ctx.channel;
        if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
        const wasEmpty = state.queue.length === 0, startPos = state.queue.length;
        state.queue.push(...tracks);

        if (tracks.length > 1) {
            await ctx.reply({ embeds: [createEmbed(`${SYM.star}  Playlist Added`, `Added **${tracks.length}** tracks to the queue.`, THEME.SUCCESS)] });
        } else if (wasEmpty) {
            await ctx.note(`Loading **${stripBrackets(clip(tracks[0].title, 100))}**…`);
        } else {
            const e = createEmbed(`${SYM.star}  Added to Queue`, `**${stripBrackets(clip(tracks[0].title, 150))}**`, THEME.SUCCESS)
                .addFields({ name: 'Position', value: String(startPos), inline: true }, { name: 'Duration', value: tracks[0].duration || 'Live', inline: true });
            if (tracks[0].thumbnail) e.setThumbnail(tracks[0].thumbnail);
            await ctx.reply({ embeds: [e] });
        }
        if (wasEmpty) playNext(ctx.guild.id);
    }
});

defineCommand({
    name: 'pause', category: 'music', description: 'Pause the current track',
    needsPlayer: true, vc: true, sameVC: true,
    async execute(ctx) {
        const s = music.get(ctx.guild.id);
        if (s.paused) return ctx.fail('Already paused. Use `' + ctx.prefix + 'resume`.');
        return pauseTrack(s) ? ctx.ok('Paused.') : ctx.fail('Nothing is playing.');
    }
});

defineCommand({
    name: 'resume', aliases: ['unpause'], category: 'music', description: 'Resume playback',
    needsPlayer: true, vc: true, sameVC: true,
    async execute(ctx) {
        const s = music.get(ctx.guild.id);
        if (!s.paused) return ctx.fail('Playback is not paused.');
        return resumeTrack(s) ? ctx.ok('Resumed.') : ctx.fail('Could not resume.');
    }
});

defineCommand({
    name: 'playpause', aliases: ['pp'], category: 'music', description: 'Toggle pause / resume',
    needsPlayer: true, vc: true, sameVC: true,
    async execute(ctx) {
        const s = music.get(ctx.guild.id);
        if (s.paused) return resumeTrack(s) ? ctx.ok('Resumed.') : ctx.fail('Could not resume.');
        return pauseTrack(s) ? ctx.ok('Paused.') : ctx.fail('Nothing is playing.');
    }
});

defineCommand({
    name: 'skip', aliases: ['s', 'next'], category: 'music', description: 'Skip the current track',
    needsPlayer: true, vc: true, sameVC: true,
    async execute(ctx) {
        return skipTrack(music.get(ctx.guild.id)) ? ctx.ok('Skipped.') : ctx.fail('Nothing to skip.');
    }
});

defineCommand({
    name: 'previous', aliases: ['prev', 'back'], category: 'music', description: 'Go back to the previous track',
    needsPlayer: true, vc: true, sameVC: true,
    async execute(ctx) {
        const s = music.get(ctx.guild.id);
        if (!s.history.length) return ctx.fail('There is no previous track.');
        return skipTrack(s, 'previous') ? ctx.ok('Going back.') : ctx.fail('Nothing to go back from.');
    }
});

defineCommand({
    name: 'voteskip', aliases: ['vs'], category: 'music', description: 'Vote to skip (majority of listeners)',
    needsPlayer: true, vc: true, sameVC: true,
    async execute(ctx) {
        const s = music.get(ctx.guild.id);
        if (!s.queue.length) return ctx.fail('Nothing to skip.');
        const need = Math.max(1, Math.ceil(humansIn(botVoiceChannel(ctx.guild)) / 2));
        s.votes.add(ctx.user.id);
        if (s.votes.size >= need) { skipTrack(s); return ctx.ok(`Vote passed (${need}/${need}). Skipped.`); }
        return ctx.note(`Vote added — **${s.votes.size}/${need}** needed to skip.`);
    }
});

defineCommand({
    name: 'stop', category: 'music', description: 'Stop playback and clear the queue',
    needsPlayer: true, vc: true, sameVC: true,
    async execute(ctx) {
        stopPlayback(music.get(ctx.guild.id));
        return ctx.ok('Stopped and cleared the queue.');
    }
});

defineCommand({
    name: 'loop', aliases: ['repeat'], category: 'music', description: 'Loop the track or queue (off / track / queue)',
    options: [{ name: 'mode', type: 'string', description: 'off, track or queue', required: false, choices: ['off', 'track', 'queue'] }],
    needsPlayer: true, vc: true, sameVC: true, example: '.loop queue',
    async execute(ctx) {
        const s = music.get(ctx.guild.id);
        const mode = ctx.opts.mode || (s.loop === 'off' ? 'track' : s.loop === 'track' ? 'queue' : 'off');
        setLoop(s, mode);
        const text = { off: 'Loop is **off**.', track: 'Looping the **current track**.', queue: 'Looping the **whole queue**.' }[mode];
        return ctx.ok(text);
    }
});

defineCommand({
    name: 'queue', aliases: ['q'], category: 'music', description: 'Show the queue',
    options: [{ name: 'page', type: 'integer', description: 'Page number', required: false }],
    needsPlayer: true,
    async execute(ctx) {
        const s = music.get(ctx.guild.id), per = 10;
        const upcoming = s.queue.slice(1), pages = Math.max(1, Math.ceil(upcoming.length / per));
        const page = Math.min(Math.max(ctx.opts.page || 1, 1), pages), cur = s.queue[0];
        const lines = upcoming.slice((page - 1) * per, page * per).map((t, i) =>
            `\`${(page - 1) * per + i + 1}.\` ${clip(stripBrackets(t.title), 55)} \`${t.duration || 'Live'}\` ${SYM.dot} ${clip(t.requester || '', 18)}`);
        const head = cur ? `**${SYM.star} Now:** [${stripBrackets(clip(cur.title, 60))}](${cur.url || 'https://soundcloud.com'}) \`${cur.duration || 'Live'}\`` : 'Nothing is playing.';
        const e = createEmbed(`${CATEGORIES.music.icon}  Music Queue`, `${head}\n\n${lines.join('\n') || '*Nothing queued — add songs with* `' + ctx.prefix + 'play`'}`)
            .addFields({ name: 'Details', value: `${upcoming.length} up next ${SYM.dot} ${fmtDuration(queueSummary(s).total)} total ${SYM.dot} Loop: ${LOOP_LABEL[s.loop]} ${SYM.dot} Page ${page}/${pages}` });
        return ctx.reply({ embeds: [e] });
    }
});

defineCommand({
    name: 'nowplaying', aliases: ['np'], category: 'music', description: 'Show the current track and progress',
    needsPlayer: true,
    async execute(ctx) {
        const s = music.get(ctx.guild.id), song = s.queue[0];
        if (!song) return ctx.fail('Nothing is playing.');
        const e = buildNowPlaying(s, song);
        if (song.durationSec) {
            const el = Math.min(elapsedMs(s) / 1000, song.durationSec);
            e.addFields({ name: 'Progress', value: `\`${fmtDuration(Math.floor(el))}\`  ${progressBar(el / song.durationSec)}  \`${song.duration}\`` });
        }
        return ctx.reply({ embeds: [e] });
    }
});

defineCommand({
    name: 'shuffle', category: 'music', description: 'Shuffle the upcoming tracks',
    needsPlayer: true, vc: true, sameVC: true,
    async execute(ctx) {
        const s = music.get(ctx.guild.id);
        if (s.queue.length < 3) return ctx.fail('Need at least 2 upcoming tracks to shuffle.');
        const rest = shuffleInPlace(s.queue.slice(1));
        s.queue.splice(1, s.queue.length - 1, ...rest);
        refreshNowPlaying(s);
        return ctx.ok(`Shuffled **${rest.length}** tracks.`);
    }
});

defineCommand({
    name: 'remove', aliases: ['rm'], category: 'music', description: 'Remove a track from the queue by position',
    options: [{ name: 'position', type: 'integer', description: 'Position shown in the queue', required: true }],
    needsPlayer: true, vc: true, sameVC: true, example: '.remove 3',
    async execute(ctx) {
        const s = music.get(ctx.guild.id), n = ctx.opts.position;
        if (n < 1 || n >= s.queue.length) return ctx.fail(`Pick a position between 1 and ${s.queue.length - 1}.`);
        const [removed] = s.queue.splice(n, 1);
        refreshNowPlaying(s);
        return ctx.ok(`Removed **${stripBrackets(clip(removed.title, 80))}**.`);
    }
});

defineCommand({
    name: 'clear', aliases: ['clearqueue', 'cq'], category: 'music', description: 'Clear upcoming tracks (keeps the current one)',
    needsPlayer: true, vc: true, sameVC: true,
    async execute(ctx) {
        const s = music.get(ctx.guild.id), n = Math.max(0, s.queue.length - 1);
        s.queue.length = Math.min(s.queue.length, 1);
        refreshNowPlaying(s);
        return ctx.ok(`Cleared **${n}** upcoming tracks.`);
    }
});

defineCommand({
    name: 'move', category: 'music', description: 'Move a track to a new queue position',
    options: [
        { name: 'from', type: 'integer', description: 'Current position', required: true },
        { name: 'to', type: 'integer', description: 'New position', required: true }
    ],
    needsPlayer: true, vc: true, sameVC: true, example: '.move 5 1',
    async execute(ctx) {
        const s = music.get(ctx.guild.id), { from, to } = ctx.opts, max = s.queue.length - 1;
        if (from < 1 || from > max || to < 1 || to > max) return ctx.fail(`Positions must be between 1 and ${max}.`);
        const [t] = s.queue.splice(from, 1);
        s.queue.splice(to, 0, t);
        return ctx.ok(`Moved **${stripBrackets(clip(t.title, 60))}** to position **${to}**.`);
    }
});

defineCommand({
    name: 'join', aliases: ['summon'], category: 'music', description: 'Make the bot join your voice channel',
    vc: true,
    async execute(ctx) {
        const vc = ctx.member.voice.channel, existing = botVoiceChannel(ctx.guild);
        if (existing && existing.id === vc.id) return ctx.ok(`Already in ${vc}.`);
        if (existing) return ctx.fail(`I'm already in ${existing}. Use \`${ctx.prefix}go\` to move me.`);
        if (!vc.permissionsFor(ctx.guild.members.me).has(['ViewChannel', 'Connect', 'Speak'])) return ctx.fail(`I need **Connect** and **Speak** in ${vc}.`);
        let s;
        try { s = await ensureState(ctx.guild, vc, ctx.channel); } catch (e) { return ctx.fail(e.message); }
        scheduleIdleLeave(s);
        return ctx.ok(`Joined ${vc}.`);
    }
});

defineCommand({
    name: 'leave', aliases: ['disconnect', 'dc'], category: 'music', description: 'Make the bot leave the voice channel',
    needsPlayer: true, vc: true, sameVC: true,
    async execute(ctx) {
        cleanupMusic(ctx.guild.id);
        return ctx.ok('Left the voice channel.');
    }
});

defineCommand({
    name: 'go', aliases: ['moveto'], category: 'music', description: 'Move the bot to another voice channel',
    options: [{ name: 'channel', type: 'channel', description: 'Voice channel (default: yours)', required: false, channelTypes: VOICE_ONLY }],
    needsPlayer: true, example: '.go #General',
    async execute(ctx) {
        const s = music.get(ctx.guild.id);
        const target = ctx.opts.channel || ctx.member.voice.channel;
        if (!target) return ctx.fail('Mention a voice channel, or join one first.');
        if (target.type !== ChannelType.GuildVoice) return ctx.fail('That is not a voice channel.');
        if (botVoiceChannel(ctx.guild)?.id === target.id) return ctx.ok(`Already in ${target}.`);
        if (!target.permissionsFor(ctx.guild.members.me).has(['ViewChannel', 'Connect', 'Speak'])) return ctx.fail(`I need **Connect** and **Speak** in ${target}.`);
        try { await moveBot(s, ctx.guild, target); } catch (e) { return ctx.fail('Could not move: ' + clip(e.message, 100)); }
        return ctx.ok(`Moved to ${target}. The queue is kept.`);
    }
});

defineCommand({
    name: 'stay', aliases: ['247'], category: 'music', description: 'Toggle 24/7 mode (never auto-leave)',
    vc: true, userPerms: ['ManageGuild'],
    async execute(ctx) {
        let s = music.get(ctx.guild.id);
        if (!s) {
            try { s = await ensureState(ctx.guild, ctx.member.voice.channel, ctx.channel); } catch (e) { return ctx.fail(e.message); }
        }
        s.stay = !s.stay;
        if (s.stay) { clearTimers(s); return ctx.ok('24/7 mode **on** — I will stay in the channel.'); }
        if (!s.queue.length) scheduleIdleLeave(s);
        return ctx.ok('24/7 mode **off**.');
    }
});

defineCommand({
    name: 'playlist', aliases: ['pl'], category: 'music', description: 'Save, play, list or delete your playlists',
    options: [
        { name: 'action', type: 'string', description: 'save, play, list or delete', required: true, choices: ['save', 'play', 'list', 'delete'] },
        { name: 'name', type: 'string', description: 'Playlist name', required: false }
    ],
    defer: true, example: '.playlist save chill',
    async execute(ctx) {
        const userId = ctx.user.id, action = ctx.opts.action, name = (ctx.opts.name || '').trim().toLowerCase().slice(0, 40);
        if (action === 'list') {
            const lists = await Playlist.find({ userId }).lean();
            if (!lists.length) return ctx.fail('You have no saved playlists. Save one with `' + ctx.prefix + 'playlist save <name>`.');
            return ctx.reply({ embeds: [createEmbed(`${SYM.star}  Your Playlists`, lists.map(l => `${SYM.arrow} **${l.name}** — ${l.tracks.length} tracks`).join('\n'))] });
        }
        if (!name) return ctx.fail('Give the playlist a name.');

        if (action === 'delete') {
            const r = await Playlist.deleteOne({ userId, name });
            return r.deletedCount ? ctx.ok(`Deleted **${name}**.`) : ctx.fail('No playlist with that name.');
        }
        if (action === 'save') {
            const s = music.get(ctx.guild.id);
            if (!s || !s.queue.length) return ctx.fail('Queue something first, then save it.');
            const existing = await Playlist.findOne({ userId, name });
            if (!existing && (await Playlist.countDocuments({ userId })) >= 10) return ctx.fail('You can keep up to 10 playlists. Delete one first.');
            const tracks = s.queue.slice(0, 100).map(t => ({ title: t.title, url: t.url, search: t.search, duration: t.duration, durationSec: t.durationSec, thumbnail: t.thumbnail }));
            await Playlist.updateOne({ userId, name }, { $set: { tracks } }, { upsert: true });
            return ctx.ok(`Saved **${tracks.length}** tracks as **${name}**.`);
        }
        // play
        const doc = await Playlist.findOne({ userId, name }).lean();
        if (!doc || !doc.tracks.length) return ctx.fail('No playlist with that name.');
        const vc = ctx.member.voice.channel;
        if (!vc) return ctx.fail('Join a voice channel first.');
        const existingVC = botVoiceChannel(ctx.guild);
        if (existingVC && existingVC.id !== vc.id) return ctx.fail(`Join <#${existingVC.id}> to use this.`);
        let s;
        try { s = await ensureState(ctx.guild, vc, ctx.channel); } catch (e) { return ctx.fail(e.message); }
        s.textChannel = ctx.channel;
        const wasEmpty = s.queue.length === 0;
        s.queue.push(...doc.tracks.map(t => ({ ...t, requester: ctx.user.username })));
        await ctx.ok(`Queued **${doc.tracks.length}** tracks from **${name}**.`);
        if (wasEmpty) playNext(ctx.guild.id);
    }
});

// ─── Voice utilities (about you / other members) ─────────────────────────────
defineCommand({
    name: 'sleep', category: 'music', description: 'Disconnect yourself from voice after a delay',
    options: [{ name: 'time', type: 'string', description: 'e.g. 30m, 1h, or "off" to cancel', required: true }],
    botPerms: ['MoveMembers'], example: '.sleep 45m',
    async execute(ctx) {
        const key = `${ctx.guild.id}:${ctx.user.id}`, t = ctx.opts.time;
        if (/^(off|cancel|stop)$/i.test(t)) {
            if (!sleepTimers.has(key)) return ctx.fail('You have no active sleep timer.');
            clearTimeout(sleepTimers.get(key)); sleepTimers.delete(key);
            return ctx.ok('Sleep timer cancelled.');
        }
        const ms = parseDuration(t);
        if (!ms || ms > 12 * 3600 * 1000) return ctx.fail('Use a time up to 12 hours, like `30m` or `1h30m`.');
        if (sleepTimers.has(key)) clearTimeout(sleepTimers.get(key));
        const channel = ctx.channel, guild = ctx.guild, userId = ctx.user.id;
        sleepTimers.set(key, setTimeout(async () => {
            sleepTimers.delete(key);
            const m = await guild.members.fetch(userId).catch(() => null);
            if (m?.voice?.channelId) {
                await m.voice.disconnect('Sleep timer').catch(() => {});
                channel.send({ content: `<@${userId}> ${SYM.star} Sleep timer finished — sweet dreams.`, allowedMentions: { users: [userId] } }).catch(() => {});
            }
        }, ms));
        return ctx.ok(`I'll disconnect you from voice ${ts(Date.now() + ms)}. Cancel with \`${ctx.prefix}sleep off\`.`);
    }
});

defineCommand({
    name: 'dcme', aliases: ['disconnectme', 'vcleave'], category: 'music', description: 'Disconnect yourself from voice',
    vc: true, botPerms: ['MoveMembers'],
    async execute(ctx) {
        await ctx.member.voice.disconnect('Requested by user');
        return ctx.ok('Disconnected you from voice.');
    }
});

defineCommand({
    name: 'moveme', category: 'music', description: 'Move yourself to another voice channel',
    options: [{ name: 'channel', type: 'channel', description: 'Voice channel', required: true, channelTypes: VOICE_ONLY }],
    vc: true, botPerms: ['MoveMembers'], example: '.moveme #Gaming',
    async execute(ctx) {
        const ch = ctx.opts.channel;
        if (!ch.permissionsFor(ctx.member).has(['ViewChannel', 'Connect'])) return ctx.fail("You can't join that channel.");
        await ctx.member.voice.setChannel(ch, 'Requested by user');
        return ctx.ok(`Moved you to ${ch}.`);
    }
});

defineCommand({
    name: 'vcdisconnect', aliases: ['vckick', 'vcdc'], category: 'music', description: 'Disconnect a member from voice',
    options: [{ name: 'user', type: 'user', description: 'Member to disconnect', required: true }],
    userPerms: ['MoveMembers'], botPerms: ['MoveMembers'], example: '.vcdisconnect @user',
    async execute(ctx) {
        const target = await ctx.guild.members.fetch(ctx.opts.user.id).catch(() => null);
        if (!target) return ctx.fail('That user is not in this server.');
        if (!target.voice.channelId) return ctx.fail('They are not in a voice channel.');
        const err = target.id === ctx.user.id ? null : hierarchyError(ctx, target);
        if (err) return ctx.fail(err);
        await target.voice.disconnect(`By ${ctx.user.username}`);
        return ctx.ok(`Disconnected **${target.displayName}** from voice.`);
    }
});

defineCommand({
    name: 'vcmove', category: 'music', description: 'Move a member to another voice channel',
    options: [
        { name: 'user', type: 'user', description: 'Member to move', required: true },
        { name: 'channel', type: 'channel', description: 'Destination voice channel', required: true, channelTypes: VOICE_ONLY }
    ],
    userPerms: ['MoveMembers'], botPerms: ['MoveMembers'], example: '.vcmove @user #General',
    async execute(ctx) {
        const target = await ctx.guild.members.fetch(ctx.opts.user.id).catch(() => null);
        if (!target) return ctx.fail('That user is not in this server.');
        if (!target.voice.channelId) return ctx.fail('They are not in a voice channel — I can only move people who are already in one.');
        const err = target.id === ctx.user.id ? null : hierarchyError(ctx, target);
        if (err) return ctx.fail(err);
        await target.voice.setChannel(ctx.opts.channel, `By ${ctx.user.username}`);
        return ctx.ok(`Moved **${target.displayName}** to ${ctx.opts.channel}.`);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS — UTILITY / INFO
// ═══════════════════════════════════════════════════════════════════════════════

defineCommand({
    name: 'ping', category: 'utility', description: 'Check bot latency',
    async execute(ctx) {
        const t0 = Date.now();
        await ctx.reply({ embeds: [createEmbed(`${SYM.star}  Pong`, `Gateway ${SYM.arrow} **${Math.round(client.ws.ping)}ms**`)] });
        const rt = Date.now() - t0;
        if (!ctx.isSlash) return;
        return ctx.source.editReply({ embeds: [createEmbed(`${SYM.star}  Pong`, `Gateway ${SYM.arrow} **${Math.round(client.ws.ping)}ms**\nRoundtrip ${SYM.arrow} **${rt}ms**`)] }).catch(() => {});
    }
});

defineCommand({
    name: 'botinfo', aliases: ['bot', 'stats'], category: 'utility', description: 'Bot stats (add "owner" to see the owner)',
    options: [{ name: 'section', type: 'string', description: 'Use "owner" to show the owner profile', required: false }],
    defer: true,
    async execute(ctx) {
        if (/^owner$/i.test(ctx.opts.section || '')) {
            const ownerId = OWNER_IDS[0];
            const owner = ownerId ? await client.users.fetch(ownerId).catch(() => null) : null;
            if (!owner) return ctx.fail('Owner is not configured.');
            const e = createEmbed(`${SYM.star}  Bot Owner`, `**${owner.username}**`)
                .setThumbnail(owner.displayAvatarURL({ size: 256 }))
                .addFields({ name: 'ID', value: owner.id, inline: true }, { name: 'Account created', value: ts(owner.createdTimestamp), inline: true });
            return ctx.reply({ embeds: [e] });
        }
        const users = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
        const mem = process.memoryUsage();
        const e = createEmbed(`${SYM.star}  ${client.user.username}`, 'Music, economy, moderation and more.')
            .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: 'Servers', value: fmt(client.guilds.cache.size), inline: true },
                { name: 'Users', value: fmt(users), inline: true },
                { name: 'Commands', value: String(commands.filter(c => !c.hidden).length), inline: true },
                { name: 'Latency', value: `${Math.round(client.ws.ping)}ms`, inline: true },
                { name: 'Uptime', value: fmtMs(Date.now() - STARTED_AT), inline: true },
                { name: 'Memory', value: `${(mem.rss / 1048576).toFixed(0)} MB`, inline: true },
                { name: 'Runtime', value: `Node ${process.version} ${SYM.dot} discord.js ${DJS_VERSION}`, inline: false }
            );
        return ctx.reply({ embeds: [e] });
    }
});

defineCommand({
    name: 'uptime', category: 'utility', description: 'How long the bot has been online',
    async execute(ctx) { return ctx.note(`Online for **${fmtMs(Date.now() - STARTED_AT)}** (since ${ts(STARTED_AT)}).`); }
});

defineCommand({
    name: 'invite', category: 'utility', description: 'Get the bot invite link',
    async execute(ctx) {
        const perms = new PermissionsBitField([
            'ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions', 'ManageMessages',
            'Connect', 'Speak', 'MoveMembers', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageChannels', 'ManageRoles'
        ]).bitfield;
        const url = `https://discord.com/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&permissions=${perms}&scope=bot%20applications.commands`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Invite Velno').setStyle(ButtonStyle.Link).setURL(url));
        return ctx.reply({ embeds: [createEmbed(`${SYM.star}  Invite`, 'Add the bot to your server with the button below.')], components: [row] });
    }
});

defineCommand({
    name: 'serverinfo', aliases: ['si', 'server'], category: 'utility', description: 'Information about this server',
    defer: true,
    async execute(ctx) {
        const g = ctx.guild;
        if (g.memberCount <= 1000) await g.members.fetch().catch(() => {});
        const owner = await g.fetchOwner().catch(() => null);
        const ch = g.channels.cache;
        const bots = g.members.cache.filter(m => m.user.bot).size;
        const e = createEmbed(`${SYM.star}  ${g.name}`, g.description || null)
            .setThumbnail(g.iconURL({ size: 256 }))
            .addFields(
                { name: 'Owner', value: owner ? `<@${owner.id}>` : 'Unknown', inline: true },
                { name: 'Members', value: `${fmt(g.memberCount)} (${fmt(Math.max(0, g.memberCount - bots))} humans, ${fmt(bots)} bots)`, inline: true },
                { name: 'Created', value: ts(g.createdTimestamp), inline: true },
                { name: 'Channels', value: `${ch.filter(c => c.type === ChannelType.GuildText).size} text ${SYM.dot} ${ch.filter(c => c.type === ChannelType.GuildVoice).size} voice ${SYM.dot} ${ch.filter(c => c.type === ChannelType.GuildCategory).size} categories`, inline: false },
                { name: 'Roles', value: String(g.roles.cache.size - 1), inline: true },
                { name: 'Boosts', value: `Tier ${g.premiumTier} (${g.premiumSubscriptionCount || 0})`, inline: true },
                { name: 'Verification', value: prettify(String(g.verificationLevel)), inline: true },
                { name: 'ID', value: g.id, inline: false }
            );
        const banner = g.bannerURL({ size: 1024 });
        if (banner) e.setImage(banner);
        return ctx.reply({ embeds: [e] });
    }
});

defineCommand({
    name: 'userinfo', aliases: ['ui', 'whois'], category: 'utility', description: 'Information about a user',
    options: [{ name: 'user', type: 'user', description: 'User (default: you)', required: false }],
    defer: true,
    async execute(ctx) {
        const user = ctx.opts.user || ctx.user;
        await user.fetch().catch(() => {});
        const m = await ctx.guild.members.fetch(user.id).catch(() => null);
        const badges = user.flags?.toArray().map(prettify).join(', ') || 'None';
        const e = createEmbed(`${SYM.star}  ${user.username}`, m?.nickname ? `Nickname: **${m.nickname}**` : null)
            .setThumbnail((m || user).displayAvatarURL({ size: 512 }))
            .addFields(
                { name: 'ID', value: user.id, inline: true },
                { name: 'Account created', value: ts(user.createdTimestamp), inline: true },
                { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true }
            );
        if (m) {
            const roles = m.roles.cache.filter(r => r.id !== ctx.guild.id).sort((a, b) => b.position - a.position);
            e.addFields(
                { name: 'Joined server', value: ts(m.joinedTimestamp), inline: true },
                { name: 'Top role', value: roles.first() ? `${roles.first()}` : 'None', inline: true },
                { name: `Roles (${roles.size})`, value: clip(roles.first(12).map(r => `${r}`).join(' ') || 'None', 1000), inline: false }
            );
        }
        e.addFields({ name: 'Badges', value: clip(badges, 500), inline: false });
        const prof = await Member.findOne({ guildId: ctx.guild.id, userId: user.id }).lean();
        if (prof) e.addFields({ name: 'Velno profile', value: `Level **${prof.level}** ${SYM.dot} Net worth **${SYM.coin} ${fmt(prof.balance + prof.bank)}**` });
        return ctx.reply({ embeds: [e] });
    }
});

defineCommand({
    name: 'avatar', aliases: ['av', 'pfp'], category: 'utility', description: "Show a user's avatar",
    options: [{ name: 'user', type: 'user', description: 'User (default: you)', required: false }],
    async execute(ctx) {
        const user = ctx.opts.user || ctx.user;
        const m = await ctx.guild.members.fetch(user.id).catch(() => null);
        const global = user.displayAvatarURL({ size: 4096 });
        const server = m?.avatar ? m.displayAvatarURL({ size: 4096 }) : null;
        const url = server || global;
        const ext = f => user.displayAvatarURL({ extension: f, size: 4096, forceStatic: true });
        const e = createEmbed(`${SYM.star}  ${user.username}`, server ? 'Showing the **server avatar**.' : null).setImage(url);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('PNG').setStyle(ButtonStyle.Link).setURL(ext('png')),
            new ButtonBuilder().setLabel('JPG').setStyle(ButtonStyle.Link).setURL(ext('jpg')),
            new ButtonBuilder().setLabel('WEBP').setStyle(ButtonStyle.Link).setURL(ext('webp'))
        );
        if (server) row.addComponents(new ButtonBuilder().setLabel('Global').setStyle(ButtonStyle.Link).setURL(global));
        return ctx.reply({ embeds: [e], components: [row] });
    }
});

defineCommand({
    name: 'banner', category: 'utility', description: "Show a user's profile banner",
    options: [{ name: 'user', type: 'user', description: 'User (default: you)', required: false }],
    defer: true,
    async execute(ctx) {
        const user = await (ctx.opts.user || ctx.user).fetch(true);
        const url = user.bannerURL({ size: 2048 });
        if (!url) return ctx.fail(`**${user.username}** has no profile banner.`);
        return ctx.reply({ embeds: [createEmbed(`${SYM.star}  ${user.username}`).setImage(url)] });
    }
});

defineCommand({
    name: 'roleinfo', aliases: ['ri'], category: 'utility', description: 'Information about a role',
    options: [{ name: 'role', type: 'role', description: 'The role', required: true }],
    example: '.roleinfo @Moderator',
    async execute(ctx) {
        const r = ctx.opts.role;
        const perms = r.permissions.toArray().map(prettify);
        const e = createEmbed(`${SYM.star}  ${r.name}`)
            .setColor(r.color || THEME.GOLD)
            .addFields(
                { name: 'ID', value: r.id, inline: true },
                { name: 'Color', value: r.hexColor, inline: true },
                { name: 'Members', value: String(r.members.size), inline: true },
                { name: 'Position', value: String(r.position), inline: true },
                { name: 'Hoisted', value: r.hoist ? 'Yes' : 'No', inline: true },
                { name: 'Mentionable', value: r.mentionable ? 'Yes' : 'No', inline: true },
                { name: 'Created', value: ts(r.createdTimestamp), inline: true },
                { name: 'Key permissions', value: clip(perms.includes('Administrator') ? 'Administrator' : perms.slice(0, 8).join(', ') || 'None', 1000) }
            );
        return ctx.reply({ embeds: [e] });
    }
});

defineCommand({
    name: 'channelinfo', aliases: ['ci'], category: 'utility', description: 'Information about a channel',
    options: [{ name: 'channel', type: 'channel', description: 'Channel (default: current)', required: false }],
    async execute(ctx) {
        const c = ctx.opts.channel || ctx.channel;
        const e = createEmbed(`${SYM.star}  #${c.name}`, c.topic || null).addFields(
            { name: 'ID', value: c.id, inline: true },
            { name: 'Type', value: prettify(ChannelType[c.type] || String(c.type)), inline: true },
            { name: 'Created', value: ts(c.createdTimestamp), inline: true },
            { name: 'Category', value: c.parent?.name || 'None', inline: true }
        );
        if (c.rateLimitPerUser) e.addFields({ name: 'Slowmode', value: `${c.rateLimitPerUser}s`, inline: true });
        if (c.nsfw !== undefined) e.addFields({ name: 'NSFW', value: c.nsfw ? 'Yes' : 'No', inline: true });
        if (c.bitrate) e.addFields({ name: 'Bitrate', value: `${Math.round(c.bitrate / 1000)} kbps`, inline: true }, { name: 'User limit', value: c.userLimit ? String(c.userLimit) : 'Unlimited', inline: true });
        return ctx.reply({ embeds: [e] });
    }
});

defineCommand({
    name: 'membercount', aliases: ['mc'], category: 'utility', description: 'Member count of this server',
    async execute(ctx) { return ctx.note(`**${ctx.guild.name}** has **${fmt(ctx.guild.memberCount)}** members.`); }
});

// ─── Help menu (dropdown + Home / Close) ─────────────────────────────────────
function visibleCommands(cat, viewerIsOwner) {
    return commands.filter(c => c.category === cat && (viewerIsOwner || !c.hidden));
}
function visibleCategories(viewerIsOwner) {
    return Object.keys(CATEGORIES).filter(k => visibleCommands(k, viewerIsOwner).length > 0);
}

function helpHome(ctx) {
    const cats = visibleCategories(ctx.isOwner);
    const cells = cats.map(k => `${CATEGORIES[k].icon} ${CATEGORIES[k].name}`.padEnd(15));
    const rows = [];
    for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3).join('').trimEnd());
    const total = commands.filter(c => !c.hidden).length;
    const d = [
        'Select a category below to explore commands.', '',
        '```', ...rows, '```',
        `Prefix  ${SYM.arrow}  \`${ctx.prefix}\`    Slash  ${SYM.arrow}  \`/\``,
        `\`${ctx.prefix}help <command>\` shows details for one command.`, '',
        `*${total} commands ${SYM.dot} ${client.guilds.cache.size} servers ${SYM.dot} ${Math.round(client.ws.ping)}ms ${SYM.dot} up ${fmtMs(Date.now() - STARTED_AT)}*`
    ].join('\n');
    return createEmbed(`${SYM.star}  VELNO  ${SYM.dot}  Help Center`, d).setThumbnail(client.user.displayAvatarURL({ size: 256 }));
}

function helpCategory(key, ctx) {
    const cat = CATEGORIES[key], list = visibleCommands(key, ctx.isOwner);
    let body = '';
    for (const c of list) {
        const opts = c.options.filter(o => !o.slashOnly).map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
        const perm = c.userPerms?.length ? ` ❖ \`${c.userPerms.map(permLabel).join(', ')}\`` : '';
        const line = `${SYM.arrow} \`${ctx.prefix}${c.name}${opts ? ' ' + opts : ''}\` — ${c.description}${perm}\n`;
        if (body.length + line.length > 3800) { body += '*…and more. Use the command name for details.*'; break; }
        body += line;
    }
    return createEmbed(`${cat.icon}  ${cat.name}`, `*${cat.desc}*\n\n${body}`).setThumbnail(client.user.displayAvatarURL({ size: 128 }));
}

function helpCommand(cmd, ctx) {
    const cat = CATEGORIES[cmd.category];
    const e = createEmbed(`${cat.icon}  ${ctx.prefix}${cmd.name}`, cmd.description)
        .addFields({ name: 'Usage', value: `\`${usageOf(cmd, ctx.prefix)}\``, inline: false });
    if (cmd.aliases.length) e.addFields({ name: 'Aliases', value: cmd.aliases.map(a => `\`${ctx.prefix}${a}\``).join(', '), inline: true });
    e.addFields({ name: 'Category', value: cat.name, inline: true });
    if (cmd.userPerms?.length) e.addFields({ name: 'Requires', value: cmd.userPerms.map(permLabel).join(', '), inline: true });
    if (cmd.ownerOnly) e.addFields({ name: 'Access', value: 'Bot owner only', inline: true });
    if (cmd.cooldown) e.addFields({ name: 'Cooldown', value: `${cmd.cooldown}s`, inline: true });
    if (cmd.slash !== false) e.addFields({ name: 'Slash', value: `\`/${cmd.name}\``, inline: true });
    if (cmd.example) e.addFields({ name: 'Example', value: `\`${cmd.example}\`` });
    return e;
}

defineCommand({
    name: 'help', aliases: ['h', 'commands'], category: 'utility', description: 'Browse every command',
    options: [{ name: 'query', type: 'string', description: 'A category or command name', required: false }],
    example: '.help music',
    async execute(ctx) {
        const q = (ctx.opts.query || '').toLowerCase().replace(/^[./]/, '').trim();
        if (q) {
            const cmd = commandMap.get(q);
            if (cmd && (ctx.isOwner || !cmd.hidden)) return ctx.reply({ embeds: [helpCommand(cmd, ctx)] });
        }
        const cats = visibleCategories(ctx.isOwner);
        const startKey = cats.find(k => k === q || CATEGORIES[k].name.toLowerCase() === q);
        if (q && !startKey) return ctx.fail(`No command or category named **${clip(q, 40)}**.`);

        const authorId = ctx.user.id;
        const select = new StringSelectMenuBuilder().setCustomId('help_select').setPlaceholder('▾  Select a category')
            .addOptions(cats.map(k => ({ label: `${CATEGORIES[k].icon}  ${CATEGORIES[k].name}`, value: k, description: `${visibleCommands(k, ctx.isOwner).length} commands` })));
        const homeBtn = new ButtonBuilder().setCustomId('help_home').setLabel('Home').setStyle(ButtonStyle.Secondary);
        const closeBtn = new ButtonBuilder().setCustomId('help_close').setLabel('Close').setStyle(ButtonStyle.Danger);
        const rows = () => [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(homeBtn, closeBtn)];

        const first = startKey ? helpCategory(startKey, ctx) : helpHome(ctx);
        const msg = await ctx.reply({ embeds: [first], components: rows() }, { fetch: true });
        if (!msg) return;

        const collector = msg.createMessageComponentCollector({ time: 120_000 });
        collector.on('collect', async i => {
            if (i.user.id !== authorId) return i.reply({ content: `${SYM.no} This menu belongs to someone else — run \`${ctx.prefix}help\` yourself.`, flags: MessageFlags.Ephemeral }).catch(() => {});
            if (i.customId === 'help_close') { collector.stop('closed'); return i.message.delete().catch(() => i.update({ components: [] }).catch(() => {})); }
            const embed = i.customId === 'help_select' ? helpCategory(i.values[0], ctx) : helpHome(ctx);
            return i.update({ embeds: [embed], components: rows() }).catch(() => {});
        });
        collector.on('end', (_, reason) => {
            if (reason === 'closed') return;
            select.setDisabled(true); homeBtn.setDisabled(true); closeBtn.setDisabled(true);
            msg.edit({ components: rows() }).catch(() => {});
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS — MODERATION
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_TIMEOUT_MS = 28 * 24 * 3600 * 1000;
const textOnly = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

defineCommand({
    name: 'ban', category: 'moderation', description: 'Ban a member from the server',
    options: [
        { name: 'user', type: 'user', description: 'Member to ban', required: true },
        { name: 'reason', type: 'string', description: 'Reason', required: false }
    ],
    userPerms: ['BanMembers'], botPerms: ['BanMembers'], example: '.ban @user spamming',
    async execute(ctx) {
        const { user, reason } = ctx.opts;
        const target = await ctx.guild.members.fetch(user.id).catch(() => null);
        const err = target ? hierarchyError(ctx, target) : null;
        if (err) return ctx.fail(err);
        await ctx.guild.members.ban(user.id, { reason: `${ctx.user.username}: ${reason || 'No reason provided'}` });
        const e = actionEmbed(`${SYM.star}  Member Banned`, THEME.ERROR, user, ctx.user, reason);
        await ctx.reply({ embeds: [e] });
        modLog(ctx.guild, e);
    }
});

defineCommand({
    name: 'unban', category: 'moderation', description: 'Unban a user by ID',
    options: [
        { name: 'user_id', type: 'string', description: 'ID of the banned user', required: true },
        { name: 'reason', type: 'string', description: 'Reason', required: false }
    ],
    userPerms: ['BanMembers'], botPerms: ['BanMembers'], example: '.unban 123456789012345678',
    async execute(ctx) {
        const id = ctx.opts.user_id.trim();
        if (!/^\d{15,25}$/.test(id)) return ctx.fail('Give a valid user ID.');
        try { await ctx.guild.bans.remove(id, `${ctx.user.username}: ${ctx.opts.reason || 'No reason provided'}`); }
        catch { return ctx.fail('That user is not banned.'); }
        const user = await client.users.fetch(id).catch(() => ({ id, username: 'Unknown user' }));
        const e = actionEmbed(`${SYM.star}  Member Unbanned`, THEME.SUCCESS, user, ctx.user, ctx.opts.reason);
        await ctx.reply({ embeds: [e] });
        modLog(ctx.guild, e);
    }
});

defineCommand({
    name: 'kick', category: 'moderation', description: 'Kick a member from the server',
    options: [
        { name: 'user', type: 'user', description: 'Member to kick', required: true },
        { name: 'reason', type: 'string', description: 'Reason', required: false }
    ],
    userPerms: ['KickMembers'], botPerms: ['KickMembers'], example: '.kick @user',
    async execute(ctx) {
        const target = await ctx.guild.members.fetch(ctx.opts.user.id).catch(() => null);
        if (!target) return ctx.fail('That user is not in this server.');
        const err = hierarchyError(ctx, target);
        if (err) return ctx.fail(err);
        await target.kick(`${ctx.user.username}: ${ctx.opts.reason || 'No reason provided'}`);
        const e = actionEmbed(`${SYM.star}  Member Kicked`, THEME.WARNING, ctx.opts.user, ctx.user, ctx.opts.reason);
        await ctx.reply({ embeds: [e] });
        modLog(ctx.guild, e);
    }
});

defineCommand({
    name: 'timeout', aliases: ['mute'], category: 'moderation', description: 'Timeout (mute) a member',
    options: [
        { name: 'user', type: 'user', description: 'Member', required: true },
        { name: 'duration', type: 'string', description: 'e.g. 10m, 2h, 1d (max 28d)', required: true },
        { name: 'reason', type: 'string', description: 'Reason', required: false }
    ],
    userPerms: ['ModerateMembers'], botPerms: ['ModerateMembers'], example: '.timeout @user 30m spam',
    async execute(ctx) {
        const ms = parseDuration(ctx.opts.duration);
        if (!ms || ms > MAX_TIMEOUT_MS) return ctx.fail('Use a duration up to 28 days, like `10m`, `2h` or `1d`.');
        const target = await ctx.guild.members.fetch(ctx.opts.user.id).catch(() => null);
        if (!target) return ctx.fail('That user is not in this server.');
        const err = hierarchyError(ctx, target);
        if (err) return ctx.fail(err);
        await target.timeout(ms, `${ctx.user.username}: ${ctx.opts.reason || 'No reason provided'}`);
        const e = actionEmbed(`${SYM.star}  Member Timed Out`, THEME.WARNING, ctx.opts.user, ctx.user, ctx.opts.reason,
            [{ name: 'Ends', value: ts(Date.now() + ms), inline: true }]);
        await ctx.reply({ embeds: [e] });
        modLog(ctx.guild, e);
    }
});

defineCommand({
    name: 'untimeout', aliases: ['unmute'], category: 'moderation', description: "Remove a member's timeout",
    options: [{ name: 'user', type: 'user', description: 'Member', required: true }],
    userPerms: ['ModerateMembers'], botPerms: ['ModerateMembers'],
    async execute(ctx) {
        const target = await ctx.guild.members.fetch(ctx.opts.user.id).catch(() => null);
        if (!target) return ctx.fail('That user is not in this server.');
        if (!target.communicationDisabledUntilTimestamp) return ctx.fail('They are not timed out.');
        await target.timeout(null, `By ${ctx.user.username}`);
        const e = actionEmbed(`${SYM.star}  Timeout Removed`, THEME.SUCCESS, ctx.opts.user, ctx.user, null);
        await ctx.reply({ embeds: [e] });
        modLog(ctx.guild, e);
    }
});

defineCommand({
    name: 'warn', category: 'moderation', description: 'Warn a member',
    options: [
        { name: 'user', type: 'user', description: 'Member', required: true },
        { name: 'reason', type: 'string', description: 'Reason', required: true }
    ],
    userPerms: ['ModerateMembers'], example: '.warn @user breaking rule 2',
    async execute(ctx) {
        const { user, reason } = ctx.opts;
        if (user.bot) return ctx.fail("You can't warn bots.");
        const target = await ctx.guild.members.fetch(user.id).catch(() => null);
        const err = target ? hierarchyError(ctx, target) : null;
        if (err) return ctx.fail(err);
        await Warning.create({ guildId: ctx.guild.id, userId: user.id, moderatorId: ctx.user.id, reason: clip(reason, 500) });
        const count = await Warning.countDocuments({ guildId: ctx.guild.id, userId: user.id });
        const e = actionEmbed(`${SYM.star}  Member Warned`, THEME.WARNING, user, ctx.user, reason, [{ name: 'Total warnings', value: String(count), inline: true }]);
        await ctx.reply({ embeds: [e] });
        modLog(ctx.guild, e);
    }
});

defineCommand({
    name: 'warnings', aliases: ['warns'], category: 'moderation', description: "Show a member's warnings",
    options: [{ name: 'user', type: 'user', description: 'Member (default: you)', required: false }],
    async execute(ctx) {
        const user = ctx.opts.user || ctx.user;
        if (user.id !== ctx.user.id && !ctx.member.permissions.has('ModerateMembers')) return ctx.fail('You can only view your own warnings.');
        const list = await Warning.find({ guildId: ctx.guild.id, userId: user.id }).sort({ createdAt: -1 }).limit(10).lean();
        const total = await Warning.countDocuments({ guildId: ctx.guild.id, userId: user.id });
        if (!total) return ctx.note(`**${user.username}** has no warnings.`);
        const lines = list.map((w, i) => `\`${total - i}.\` ${ts(w.createdAt.getTime())} ${SYM.dot} by <@${w.moderatorId}>\n${SYM.arrow} ${clip(w.reason, 150)}`);
        return ctx.reply({ embeds: [createEmbed(`${SYM.star}  Warnings — ${user.username}`, lines.join('\n\n')).addFields({ name: 'Total', value: String(total) })] });
    }
});

defineCommand({
    name: 'clearwarns', aliases: ['clearwarnings'], category: 'moderation', description: "Clear all of a member's warnings",
    options: [{ name: 'user', type: 'user', description: 'Member', required: true }],
    userPerms: ['ModerateMembers'],
    async execute(ctx) {
        const r = await Warning.deleteMany({ guildId: ctx.guild.id, userId: ctx.opts.user.id });
        if (!r.deletedCount) return ctx.fail('They have no warnings.');
        modLog(ctx.guild, actionEmbed(`${SYM.star}  Warnings Cleared`, THEME.SUCCESS, ctx.opts.user, ctx.user, `${r.deletedCount} warnings removed`));
        return ctx.ok(`Cleared **${r.deletedCount}** warnings for **${ctx.opts.user.username}**.`);
    }
});

defineCommand({
    name: 'purge', aliases: ['prune'], category: 'moderation', description: 'Delete recent messages (1–99)',
    options: [{ name: 'amount', type: 'integer', description: 'How many messages', required: true }],
    userPerms: ['ManageMessages'], botPerms: ['ManageMessages'], example: '.purge 20',
    async execute(ctx) {
        const n = ctx.opts.amount;
        if (n < 1 || n > 99) return ctx.fail('Choose between 1 and 99 messages.');
        const extra = ctx.isSlash ? 0 : 1;                      // also remove the command message
        const deleted = await ctx.channel.bulkDelete(n + extra, true);
        return ctx.ok(`Deleted **${Math.max(0, deleted.size - extra)}** messages. Messages older than 14 days are skipped.`, { ephemeral: true });
    }
});

defineCommand({
    name: 'slowmode', aliases: ['sm'], category: 'moderation', description: 'Set channel slowmode (0 turns it off)',
    options: [
        { name: 'seconds', type: 'integer', description: '0–21600', required: true },
        { name: 'channel', type: 'channel', description: 'Channel (default: current)', required: false, channelTypes: textOnly }
    ],
    userPerms: ['ManageChannels'], botPerms: ['ManageChannels'], example: '.slowmode 10',
    async execute(ctx) {
        const s = ctx.opts.seconds, ch = ctx.opts.channel || ctx.channel;
        if (s < 0 || s > 21600) return ctx.fail('Use a value between 0 and 21600 seconds.');
        await ch.setRateLimitPerUser(s, `By ${ctx.user.username}`);
        return ctx.ok(s ? `Slowmode in ${ch} set to **${s}s**.` : `Slowmode in ${ch} turned **off**.`);
    }
});

for (const lock of [true, false]) {
    defineCommand({
        name: lock ? 'lock' : 'unlock', category: 'moderation', description: lock ? 'Stop @everyone from sending messages in a channel' : 'Let @everyone send messages again',
        options: [{ name: 'channel', type: 'channel', description: 'Channel (default: current)', required: false, channelTypes: textOnly }],
        userPerms: ['ManageChannels'], botPerms: ['ManageChannels'],
        async execute(ctx) {
            const ch = ctx.opts.channel || ctx.channel;
            await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: lock ? false : null }, { reason: `By ${ctx.user.username}` });
            return ctx.ok(lock ? `${ch} is now **locked**.` : `${ch} is now **unlocked**.`);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS — SERVER SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

const fillTemplate = (str, member) => String(str)
    .replace(/\{user\}/gi, `<@${member.id}>`).replace(/\{username\}/gi, member.user.username)
    .replace(/\{server\}/gi, member.guild.name).replace(/\{count\}/gi, String(member.guild.memberCount));

function channelSettingCommand({ name, key, label, desc }) {
    defineCommand({
        name, category: 'server', description: desc,
        options: [
            { name: 'channel', type: 'channel', description: 'Text channel (or "off" with prefix)', required: false, channelTypes: textOnly, allowOff: true },
            { name: 'off', type: 'boolean', description: 'Turn this off', required: false, slashOnly: true }
        ],
        userPerms: ['ManageGuild'], example: `.${name} #channel`,
        async execute(ctx) {
            const cfg = await getConfig(ctx.guild.id);
            const off = ctx.opts.channel === 'off' || ctx.opts.off;
            const ch = ctx.opts.channel && ctx.opts.channel !== 'off' ? ctx.opts.channel : null;
            if (off) { await updateConfig(ctx.guild.id, { [key]: null }); return ctx.ok(`${label} turned **off**.`); }
            if (!ch) return ctx.note(`${label}: ${cfg[key] ? `<#${cfg[key]}>` : '**off**'}\nSet it with \`${ctx.prefix}${name} #channel\` or disable with \`${ctx.prefix}${name} off\`.`);
            if (!ch.permissionsFor(ctx.guild.members.me).has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) return ctx.fail(`I need **Send Messages** and **Embed Links** in ${ch}.`);
            await updateConfig(ctx.guild.id, { [key]: ch.id });
            return ctx.ok(`${label} set to ${ch}.`);
        }
    });
}
channelSettingCommand({ name: 'setmodlog', key: 'modLogChannel', label: 'Mod log channel', desc: 'Set the moderation log channel' });
channelSettingCommand({ name: 'setwelcome', key: 'welcomeChannel', label: 'Welcome channel', desc: 'Set the welcome message channel' });
channelSettingCommand({ name: 'setgoodbye', key: 'goodbyeChannel', label: 'Goodbye channel', desc: 'Set the goodbye message channel' });

function roleSettingCommand({ name, key, label, desc }) {
    defineCommand({
        name, category: 'server', description: desc,
        options: [
            { name: 'role', type: 'role', description: 'Role (or "off" with prefix)', required: false, allowOff: true },
            { name: 'off', type: 'boolean', description: 'Turn this off', required: false, slashOnly: true }
        ],
        userPerms: ['ManageGuild'], example: `.${name} @Role`,
        async execute(ctx) {
            const cfg = await getConfig(ctx.guild.id);
            const off = ctx.opts.role === 'off' || ctx.opts.off;
            const role = ctx.opts.role && ctx.opts.role !== 'off' ? ctx.opts.role : null;
            if (off) { await updateConfig(ctx.guild.id, { [key]: null }); return ctx.ok(`${label} turned **off**.`); }
            if (!role) return ctx.note(`${label}: ${cfg[key] ? `<@&${cfg[key]}>` : '**off**'}`);
            if (key === 'autoRole' && (role.managed || role.position >= ctx.guild.members.me.roles.highest.position)) {
                return ctx.fail("I can't assign that role — it's above my highest role or managed by an integration.");
            }
            await updateConfig(ctx.guild.id, { [key]: role.id });
            return ctx.ok(`${label} set to ${role}.`);
        }
    });
}
roleSettingCommand({ name: 'setautorole', key: 'autoRole', label: 'Auto role', desc: 'Give new members a role automatically' });
roleSettingCommand({ name: 'setticketrole', key: 'ticketStaffRole', label: 'Ticket staff role', desc: 'Role that can see support tickets' });

defineCommand({
    name: 'welcomemsg', category: 'server', description: 'Set the welcome text ({user} {username} {server} {count})',
    options: [{ name: 'text', type: 'string', description: 'Message with placeholders', required: true }],
    userPerms: ['ManageGuild'], example: '.welcomemsg Welcome {user} to {server}!',
    async execute(ctx) {
        const text = clip(ctx.opts.text, 1000);
        await updateConfig(ctx.guild.id, { welcomeMessage: text });
        return ctx.reply({ embeds: [createEmbed(`${SYM.ok}  Welcome message saved`, `**Preview**\n${fillTemplate(text, ctx.member)}`, THEME.SUCCESS)] });
    }
});

defineCommand({
    name: 'prefix', category: 'server', description: 'View or change the prefix for this server',
    options: [{ name: 'new_prefix', type: 'string', description: 'New prefix (1–3 characters)', required: false }],
    example: '.prefix !',
    async execute(ctx) {
        const cfg = await getConfig(ctx.guild.id), p = ctx.opts.new_prefix;
        if (!p) return ctx.note(`The prefix here is \`${cfg.prefix}\`. You can also mention me: <@${client.user.id}> help`);
        if (!ctx.member.permissions.has('ManageGuild') && !ctx.isOwner) return ctx.fail('You need the **Manage Guild** permission to change the prefix.');
        if (p.length > 3 || /\s/.test(p)) return ctx.fail('Use 1–3 characters with no spaces.');
        await updateConfig(ctx.guild.id, { prefix: p });
        return ctx.ok(`Prefix changed to \`${p}\`.`);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS — ECONOMY
// ═══════════════════════════════════════════════════════════════════════════════

const SHOP = [
    { id: 'ring', name: 'Silver Ring', price: 5000, desc: 'A modest sparkle.' },
    { id: 'cape', name: 'Velvet Cape', price: 15000, desc: 'Dramatic entrances only.' },
    { id: 'watch', name: 'Gold Watch', price: 30000, desc: 'Always on time.' },
    { id: 'crown', name: 'Golden Crown', price: 100000, desc: 'For whoever rules the leaderboard.' },
    { id: 'trophy', name: 'Velno Trophy', price: 500000, desc: 'The ultimate flex.' }
];
const coin = n => `${SYM.coin} ${fmt(n)}`;

// Atomic helpers (no negative balances, no double spend)
async function takeCoins(guildId, userId, amt) {
    await getMember(guildId, userId);
    return Member.findOneAndUpdate({ guildId, userId, balance: { $gte: amt } }, { $inc: { balance: -amt } }, { new: true });
}
async function giveCoins(guildId, userId, amt) {
    await getMember(guildId, userId);
    return Member.findOneAndUpdate({ guildId, userId }, { $inc: { balance: amt } }, { new: true });
}

defineCommand({
    name: 'balance', aliases: ['bal', 'wallet'], category: 'economy', description: 'Check your (or someone’s) balance',
    options: [{ name: 'user', type: 'user', description: 'User (default: you)', required: false }],
    async execute(ctx) {
        const user = ctx.opts.user || ctx.user;
        const m = await getMember(ctx.guild.id, user.id);
        const e = createEmbed(`${SYM.coin}  ${user.username}`)
            .setThumbnail(user.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: 'Wallet', value: coin(m.balance), inline: true },
                { name: 'Bank', value: coin(m.bank), inline: true },
                { name: 'Net worth', value: coin(m.balance + m.bank), inline: true }
            );
        return ctx.reply({ embeds: [e] });
    }
});

defineCommand({
    name: 'daily', category: 'economy', description: 'Claim your daily tribute (streaks give a bonus)',
    async execute(ctx) {
        const { id: guildId } = ctx.guild, userId = ctx.user.id, now = Date.now();
        const m = await getMember(guildId, userId);
        const last = m.lastDaily ? m.lastDaily.getTime() : 0;
        const streak = last && now - last < 172800000 ? m.dailyStreak + 1 : 1;
        const amount = 2000 + Math.min(streak - 1, 30) * 100;
        const doc = await Member.findOneAndUpdate(
            { guildId, userId, $or: [{ lastDaily: null }, { lastDaily: { $lte: new Date(now - 86400000) } }] },
            { $inc: { balance: amount }, $set: { dailyStreak: streak, lastDaily: new Date(now) } }, { new: true });
        if (!doc) return ctx.fail(`You already claimed today's tribute. Come back ${ts(last + 86400000)}.`);
        return ctx.reply({ embeds: [createEmbed(`${SYM.star}  Daily Tribute`, `You received **${coin(amount)}**.\nStreak: **${streak}** day${streak > 1 ? 's' : ''}${streak > 1 ? ' (bonus included)' : ''}`, THEME.SUCCESS)] });
    }
});

const JOBS = ['designed a logo', 'delivered packages', 'fixed a server', 'tutored a student', 'wrote some code', 'mixed a playlist', 'painted a mural', 'ran a stall at the market'];
defineCommand({
    name: 'work', category: 'economy', description: 'Work a short job for coins (10 min cooldown)',
    async execute(ctx) {
        const { id: guildId } = ctx.guild, userId = ctx.user.id, now = Date.now();
        const earned = randInt(150, 650);
        const doc = await (async () => { await getMember(guildId, userId); return Member.findOneAndUpdate(
            { guildId, userId, $or: [{ lastWork: null }, { lastWork: { $lte: new Date(now - 600000) } }] },
            { $inc: { balance: earned }, $set: { lastWork: new Date(now) } }, { new: true }); })();
        if (!doc) {
            const m = await getMember(guildId, userId);
            return ctx.fail(`You're tired. You can work again ${ts(m.lastWork.getTime() + 600000)}.`);
        }
        return ctx.reply({ embeds: [createEmbed(`${SYM.star}  Work`, `You ${pick(JOBS)} and earned **${coin(earned)}**.`, THEME.SUCCESS)] });
    }
});

defineCommand({
    name: 'pay', aliases: ['give', 'transfer'], category: 'economy', description: 'Send coins to another member',
    options: [
        { name: 'user', type: 'user', description: 'Recipient', required: true },
        { name: 'amount', type: 'string', description: 'Amount (e.g. 500, 1.5k, all)', required: true }
    ],
    example: '.pay @user 500',
    async execute(ctx) {
        const target = ctx.opts.user;
        if (target.bot) return ctx.fail("Bots don't accept payments.");
        if (target.id === ctx.user.id) return ctx.fail("You can't pay yourself.");
        const me = await getMember(ctx.guild.id, ctx.user.id);
        const amt = parseAmount(ctx.opts.amount, me.balance);
        if (!amt || amt < 1) return ctx.fail('Enter a valid amount.');
        if (!(await takeCoins(ctx.guild.id, ctx.user.id, amt))) return ctx.fail('You do not have that much in your wallet.');
        await giveCoins(ctx.guild.id, target.id, amt);
        return ctx.ok(`Sent **${coin(amt)}** to **${target.username}**.`);
    }
});

defineCommand({
    name: 'deposit', aliases: ['dep'], category: 'economy', description: 'Move coins from wallet to bank',
    options: [{ name: 'amount', type: 'string', description: 'Amount (e.g. 500, all)', required: true }],
    async execute(ctx) {
        const m = await getMember(ctx.guild.id, ctx.user.id), amt = parseAmount(ctx.opts.amount, m.balance);
        if (!amt || amt < 1) return ctx.fail('Enter a valid amount.');
        const doc = await Member.findOneAndUpdate({ guildId: ctx.guild.id, userId: ctx.user.id, balance: { $gte: amt } }, { $inc: { balance: -amt, bank: amt } }, { new: true });
        if (!doc) return ctx.fail('You do not have that much in your wallet.');
        return ctx.ok(`Deposited **${coin(amt)}**. Bank: **${coin(doc.bank)}**.`);
    }
});

defineCommand({
    name: 'withdraw', aliases: ['with'], category: 'economy', description: 'Move coins from bank to wallet',
    options: [{ name: 'amount', type: 'string', description: 'Amount (e.g. 500, all)', required: true }],
    async execute(ctx) {
        const m = await getMember(ctx.guild.id, ctx.user.id), amt = parseAmount(ctx.opts.amount, m.bank);
        if (!amt || amt < 1) return ctx.fail('Enter a valid amount.');
        const doc = await Member.findOneAndUpdate({ guildId: ctx.guild.id, userId: ctx.user.id, bank: { $gte: amt } }, { $inc: { bank: -amt, balance: amt } }, { new: true });
        if (!doc) return ctx.fail('You do not have that much in your bank.');
        return ctx.ok(`Withdrew **${coin(amt)}**. Wallet: **${coin(doc.balance)}**.`);
    }
});

defineCommand({
    name: 'coinflip', aliases: ['cf'], category: 'economy', description: 'Bet on a coin flip (double or nothing)',
    options: [
        { name: 'amount', type: 'string', description: 'Bet (e.g. 500, all)', required: true },
        { name: 'side', type: 'string', description: 'heads or tails', required: false, choices: ['heads', 'tails'] }
    ],
    cooldown: 3, example: '.coinflip 500 tails',
    async execute(ctx) {
        const m = await getMember(ctx.guild.id, ctx.user.id), bet = parseAmount(ctx.opts.amount, m.balance);
        if (!bet || bet < 1) return ctx.fail('Enter a valid bet.');
        if (!(await takeCoins(ctx.guild.id, ctx.user.id, bet))) return ctx.fail('You do not have that much in your wallet.');
        const side = ctx.opts.side || 'heads', result = Math.random() < 0.5 ? 'heads' : 'tails', win = side === result;
        const doc = win ? await giveCoins(ctx.guild.id, ctx.user.id, bet * 2) : await getMember(ctx.guild.id, ctx.user.id);
        return ctx.reply({ embeds: [createEmbed(win ? `${SYM.star}  You won!` : `${SYM.no}  You lost`,
            `You picked **${side}** — it landed on **${result}**.\n${win ? `Won **${coin(bet)}**` : `Lost **${coin(bet)}**`}\nWallet: **${coin(doc.balance)}**`,
            win ? THEME.SUCCESS : THEME.ERROR)] });
    }
});

const SLOT_SYMBOLS = ['✦', '◈', '❖', '▲', '♪', '✧'];
defineCommand({
    name: 'slots', aliases: ['slot'], category: 'economy', description: 'Spin the slot machine',
    options: [{ name: 'amount', type: 'string', description: 'Bet (e.g. 500, all)', required: true }],
    cooldown: 3, example: '.slots 500',
    async execute(ctx) {
        const m = await getMember(ctx.guild.id, ctx.user.id), bet = parseAmount(ctx.opts.amount, m.balance);
        if (!bet || bet < 1) return ctx.fail('Enter a valid bet.');
        if (!(await takeCoins(ctx.guild.id, ctx.user.id, bet))) return ctx.fail('You do not have that much in your wallet.');
        const r = [pick(SLOT_SYMBOLS), pick(SLOT_SYMBOLS), pick(SLOT_SYMBOLS)];
        const unique3 = new Set(r).size;
        const payout = unique3 === 1 ? bet * 10 : unique3 === 2 ? Math.floor(bet * 1.5) : 0;
        const doc = payout ? await giveCoins(ctx.guild.id, ctx.user.id, payout) : await getMember(ctx.guild.id, ctx.user.id);
        const title = unique3 === 1 ? `${SYM.star}  JACKPOT` : payout ? `${SYM.star}  Two of a kind` : `${SYM.no}  No match`;
        const result = payout ? `Won **${coin(payout - bet)}** net` : `Lost **${coin(bet)}**`;
        return ctx.reply({ embeds: [createEmbed(title, `**[  ${r.join('   ')}  ]**\n\n${result}\nWallet: **${coin(doc.balance)}**`, payout ? THEME.SUCCESS : THEME.ERROR)] });
    }
});

defineCommand({
    name: 'leaderboard', aliases: ['lb', 'top'], category: 'economy', description: 'Top 10 richest or highest level',
    options: [{ name: 'type', type: 'string', description: 'money or level', required: false, choices: ['money', 'level'] }],
    defer: true,
    async execute(ctx) {
        const type = ctx.opts.type || 'money', guildId = ctx.guild.id;
        const rows = type === 'level'
            ? await Member.find({ guildId }).sort({ level: -1, xp: -1 }).limit(10).lean()
            : await Member.aggregate([{ $match: { guildId } }, { $addFields: { net: { $add: ['$balance', '$bank'] } } }, { $sort: { net: -1 } }, { $limit: 10 }]);
        if (!rows.length) return ctx.fail('Nobody is on the leaderboard yet.');
        const names = await Promise.all(rows.map(r => client.users.fetch(r.userId).then(u => u.username).catch(() => 'Unknown')));
        const lines = rows.map((r, i) => `\`${String(i + 1).padStart(2, '0')}\` **${clip(stripBrackets(names[i]), 24)}** ${SYM.dot} ${type === 'level' ? `Level ${r.level} (${fmt(r.xp)} xp)` : coin(r.net)}`);
        return ctx.reply({ embeds: [createEmbed(`${type === 'level' ? CATEGORIES.leveling.icon : SYM.coin}  ${ctx.guild.name} — ${type === 'level' ? 'Top Levels' : 'Richest Members'}`, lines.join('\n'))] });
    }
});

defineCommand({
    name: 'shop', category: 'economy', description: 'Browse the shop',
    async execute(ctx) {
        const lines = SHOP.map(i => `${SYM.arrow} **${i.name}** — ${coin(i.price)}\n\u2003${i.desc}  \`${ctx.prefix}buy ${i.id}\``);
        return ctx.reply({ embeds: [createEmbed(`${SYM.coin}  Velno Shop`, lines.join('\n\n'))] });
    }
});

defineCommand({
    name: 'buy', category: 'economy', description: 'Buy an item from the shop',
    options: [
        { name: 'item', type: 'string', description: 'Item to buy', required: true, choices: SHOP.map(i => ({ name: i.name, value: i.id })) },
        { name: 'amount', type: 'integer', description: 'How many (default 1)', required: false }
    ],
    example: '.buy crown',
    async execute(ctx) {
        const item = SHOP.find(i => i.id === ctx.opts.item);
        const qty = Math.min(Math.max(ctx.opts.amount || 1, 1), 50), cost = item.price * qty;
        if (!(await takeCoins(ctx.guild.id, ctx.user.id, cost))) return ctx.fail(`You need **${coin(cost)}** in your wallet.`);
        await Member.updateOne({ guildId: ctx.guild.id, userId: ctx.user.id }, { $push: { inventory: { $each: Array(qty).fill(item.id) } } });
        return ctx.ok(`Bought **${qty}× ${item.name}** for **${coin(cost)}**.`);
    }
});

defineCommand({
    name: 'inventory', aliases: ['inv'], category: 'economy', description: 'Show your items',
    options: [{ name: 'user', type: 'user', description: 'User (default: you)', required: false }],
    async execute(ctx) {
        const user = ctx.opts.user || ctx.user, m = await getMember(ctx.guild.id, user.id);
        const counts = {};
        for (const id of m.inventory) counts[id] = (counts[id] || 0) + 1;
        const lines = Object.entries(counts).map(([id, n]) => `${SYM.arrow} **${SHOP.find(i => i.id === id)?.name || id}** × ${n}`);
        return ctx.reply({ embeds: [createEmbed(`${SYM.coin}  ${user.username}'s Inventory`, lines.join('\n') || '*Empty — visit the shop!*')] });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS — LEVELING
// ═══════════════════════════════════════════════════════════════════════════════

const xpCooldown = new Map();

async function grantXp(message) {
    const key = `${message.guild.id}:${message.author.id}`;
    if (Date.now() - (xpCooldown.get(key) || 0) < 30_000) return;
    xpCooldown.set(key, Date.now());
    const m = await getMember(message.guild.id, message.author.id);
    m.xp += randInt(15, 25);
    let leveled = false;
    while (m.xp >= xpFor(m.level)) { m.xp -= xpFor(m.level); m.level++; leveled = true; }
    await m.save();
    if (!leveled) return;
    const cfg = await getConfig(message.guild.id);
    if (cfg.levelMessages) {
        message.channel.send({ embeds: [createEmbed(null, `${SYM.star}  <@${message.author.id}> reached **level ${m.level}**!`)], allowedMentions: { parse: [] } }).catch(() => {});
    }
    const me = message.guild.members.me;
    for (const lr of (cfg.levelRoles || []).filter(r => r.level <= m.level)) {
        const role = message.guild.roles.cache.get(lr.roleId);
        if (role && role.position < me.roles.highest.position && !message.member.roles.cache.has(role.id)) {
            message.member.roles.add(role, 'Level reward').catch(() => {});
        }
    }
}

defineCommand({
    name: 'rank', aliases: ['level', 'xp'], category: 'leveling', description: 'Show your level and XP',
    options: [{ name: 'user', type: 'user', description: 'User (default: you)', required: false }],
    async execute(ctx) {
        const user = ctx.opts.user || ctx.user;
        const m = await getMember(ctx.guild.id, user.id), need = xpFor(m.level), pct = Math.min(m.xp / need, 1), filled = Math.floor(pct * 12);
        const pos = (await Member.countDocuments({ guildId: ctx.guild.id, $or: [{ level: { $gt: m.level } }, { level: m.level, xp: { $gt: m.xp } }] })) + 1;
        const e = createEmbed(`${CATEGORIES.leveling.icon}  ${user.username}`)
            .setThumbnail(user.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: 'Level', value: String(m.level), inline: true },
                { name: 'Rank', value: `#${pos}`, inline: true },
                { name: 'XP', value: `${fmt(m.xp)} / ${fmt(need)}`, inline: true },
                { name: 'Progress', value: `${'▰'.repeat(filled)}${'▱'.repeat(12 - filled)}  ${Math.floor(pct * 100)}%` }
            );
        return ctx.reply({ embeds: [e] });
    }
});

defineCommand({
    name: 'levelrole', aliases: ['lr'], category: 'leveling', description: 'Give a role at a level (add / remove / list)',
    options: [
        { name: 'action', type: 'string', description: 'add, remove or list', required: true, choices: ['add', 'remove', 'list'] },
        { name: 'level', type: 'integer', description: 'Level', required: false },
        { name: 'role', type: 'role', description: 'Role to give', required: false }
    ],
    userPerms: ['ManageRoles'], example: '.levelrole add 10 @Regular',
    async execute(ctx) {
        const cfg = await getConfig(ctx.guild.id), list = cfg.levelRoles || [], { action, level, role } = ctx.opts;
        if (action === 'list') {
            if (!list.length) return ctx.fail('No level roles set. Add one with `' + ctx.prefix + 'levelrole add <level> <@role>`.');
            return ctx.reply({ embeds: [createEmbed(`${CATEGORIES.leveling.icon}  Level Roles`, [...list].sort((a, b) => a.level - b.level).map(r => `${SYM.arrow} Level **${r.level}** → <@&${r.roleId}>`).join('\n'))] });
        }
        if (!level || level < 1) return ctx.fail('Give a level of 1 or higher.');
        if (action === 'remove') {
            const next = list.filter(r => r.level !== level);
            if (next.length === list.length) return ctx.fail('No role is set for that level.');
            await updateConfig(ctx.guild.id, { levelRoles: next });
            return ctx.ok(`Removed the reward for level **${level}**.`);
        }
        if (!role) return ctx.fail('Mention the role to give.');
        if (role.managed || role.position >= ctx.guild.members.me.roles.highest.position) return ctx.fail("I can't assign that role — it's above my highest role or managed by an integration.");
        const next = list.filter(r => r.level !== level).concat({ level, roleId: role.id });
        await updateConfig(ctx.guild.id, { levelRoles: next });
        return ctx.ok(`Members reaching level **${level}** will receive ${role}.`);
    }
});

defineCommand({
    name: 'levelmsg', category: 'leveling', description: 'Turn level-up announcements on or off',
    options: [{ name: 'state', type: 'boolean', description: 'on or off', required: true }],
    userPerms: ['ManageGuild'], example: '.levelmsg off',
    async execute(ctx) {
        await updateConfig(ctx.guild.id, { levelMessages: ctx.opts.state });
        return ctx.ok(`Level-up messages **${ctx.opts.state ? 'on' : 'off'}**.`);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS — FUN
// ═══════════════════════════════════════════════════════════════════════════════

const EIGHT_BALL = ['It is certain.', 'Without a doubt.', 'Yes — definitely.', 'Most likely.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.', "Don't count on it.", 'My sources say no.', 'Very doubtful.', 'Outlook not so good.'];
defineCommand({
    name: '8ball', aliases: ['8b'], category: 'fun', description: 'Ask the magic 8-ball',
    options: [{ name: 'question', type: 'string', description: 'Your question', required: true }],
    cooldown: 2,
    async execute(ctx) {
        return ctx.reply({ embeds: [createEmbed(`${SYM.star}  8-Ball`, `**${clip(ctx.opts.question, 200)}**\n${SYM.arrow} ${pick(EIGHT_BALL)}`)] });
    }
});

defineCommand({
    name: 'choose', aliases: ['pick'], category: 'fun', description: 'Pick one option (separate with | or ,)',
    options: [{ name: 'options', type: 'string', description: 'e.g. pizza | burger | sushi', required: true }],
    example: '.choose pizza | burger | sushi',
    async execute(ctx) {
        const raw = ctx.opts.options, sep = raw.includes('|') ? '|' : raw.includes(',') ? ',' : /\s/;
        const list = raw.split(sep).map(s => s.trim()).filter(Boolean);
        if (list.length < 2) return ctx.fail('Give me at least two options, separated by `|` or `,`.');
        return ctx.reply({ embeds: [createEmbed(`${SYM.star}  I choose…`, `**${clip(pick(list), 200)}**`)] });
    }
});

const NUM_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
defineCommand({
    name: 'poll', category: 'fun', description: 'Start a poll: question | option | option …',
    options: [{ name: 'poll', type: 'string', description: 'Question | option 1 | option 2 …', required: true }],
    cooldown: 5, example: '.poll Best language? | JavaScript | Python | Rust',
    async execute(ctx) {
        const parts = ctx.opts.poll.split('|').map(s => s.trim()).filter(Boolean);
        const question = parts.shift();
        if (parts.length > 9) return ctx.fail('A poll can have up to 9 options.');
        const yesNo = parts.length === 0;
        if (!yesNo && parts.length < 2) return ctx.fail('Give at least two options, or just a question for a yes/no poll.');
        const body = yesNo ? '👍 Yes\n👎 No' : parts.map((p, i) => `${NUM_EMOJI[i]}  ${clip(p, 150)}`).join('\n');
        const msg = await ctx.reply({ embeds: [createEmbed(`${SYM.star}  ${clip(question, 240)}`, body).setAuthor({ name: `Poll by ${ctx.user.username}` })] }, { fetch: true });
        if (!msg) return;
        for (const r of (yesNo ? ['👍', '👎'] : NUM_EMOJI.slice(0, parts.length))) await msg.react(r).catch(() => {});
    }
});

defineCommand({
    name: 'remind', aliases: ['remindme'], category: 'fun', description: 'Get a reminder later (e.g. 10m, 2h, 1d)',
    options: [
        { name: 'time', type: 'string', description: 'When, e.g. 30m, 2h, 1d', required: true },
        { name: 'text', type: 'string', description: 'What to remind you about', required: true }
    ],
    cooldown: 3, example: '.remind 2h take the pizza out',
    async execute(ctx) {
        const ms = parseDuration(ctx.opts.time);
        if (!ms || ms < 10_000 || ms > 30 * 86400000) return ctx.fail('Use a time between 10 seconds and 30 days, like `30m` or `2h`.');
        if ((await Reminder.countDocuments({ userId: ctx.user.id })) >= 20) return ctx.fail('You already have 20 pending reminders.');
        const at = new Date(Date.now() + ms);
        await Reminder.create({ userId: ctx.user.id, channelId: ctx.channel.id, text: clip(ctx.opts.text, 500), at });
        return ctx.ok(`I'll remind you ${ts(at.getTime())}.`);
    }
});

const afkUsers = new Map(); // `${guildId}:${userId}` → { reason, since }
defineCommand({
    name: 'afk', category: 'fun', description: 'Set yourself as AFK',
    options: [{ name: 'reason', type: 'string', description: 'Why you are away', required: false }],
    async execute(ctx) {
        afkUsers.set(`${ctx.guild.id}:${ctx.user.id}`, { reason: clip(ctx.opts.reason || 'AFK', 150), since: Date.now() });
        return ctx.ok(`You are now AFK: ${clip(ctx.opts.reason || 'AFK', 150)}`);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS — TICKETS
// ═══════════════════════════════════════════════════════════════════════════════

defineCommand({
    name: 'ticket', aliases: ['tickets'], category: 'tickets', description: 'Post the support-ticket panel in this channel',
    userPerms: ['Administrator'], botPerms: ['ManageChannels'],
    async execute(ctx) {
        const e = createEmbed(`${CATEGORIES.tickets.icon}  Support`, 'Need help? Press the button below to open a private channel with the staff team.')
            .setThumbnail(ctx.guild.iconURL({ size: 256 }));
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_open').setLabel('Open Ticket').setStyle(ButtonStyle.Secondary));
        await ctx.channel.send({ embeds: [e], components: [row] });
        return ctx.ok('Ticket panel posted.', { ephemeral: true });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS — OWNER ONLY (prefix only, hidden from everyone but the owner)
// Access is checked against OWNER_ID (user IDs only, never usernames).
// ═══════════════════════════════════════════════════════════════════════════════

const ACTIVITY_TYPES = { playing: ActivityType.Playing, watching: ActivityType.Watching, listening: ActivityType.Listening, competing: ActivityType.Competing };

function applyPresence() {
    if (!client.user) return;
    client.user.setPresence({
        status: botSettings.status || 'online',
        activities: botSettings.activityText ? [{ name: botSettings.activityText, type: ACTIVITY_TYPES[botSettings.activityType] ?? ActivityType.Watching }] : []
    });
}

defineCommand({
    name: 'setstatus', category: 'owner', description: 'Set the bot status (online / idle / dnd / invisible)',
    options: [{ name: 'status', type: 'string', description: 'Status', required: true, choices: ['online', 'idle', 'dnd', 'invisible'] }],
    async execute(ctx) {
        await saveSettings({ status: ctx.opts.status });
        applyPresence();
        return ctx.ok(`Status set to **${ctx.opts.status}**.`);
    }
});

defineCommand({
    name: 'setactivity', category: 'owner', description: 'Set the activity (playing / watching / listening / competing)',
    options: [
        { name: 'type', type: 'string', description: 'Activity type', required: true, choices: ['playing', 'watching', 'listening', 'competing', 'clear'] },
        { name: 'text', type: 'string', description: 'Activity text', required: false }
    ],
    example: '.setactivity watching over the Empire',
    async execute(ctx) {
        if (ctx.opts.type === 'clear') { await saveSettings({ activityText: '' }); applyPresence(); return ctx.ok('Activity cleared.'); }
        if (!ctx.opts.text) return ctx.fail('Add the activity text.');
        await saveSettings({ activityType: ctx.opts.type, activityText: clip(ctx.opts.text, 120) });
        applyPresence();
        return ctx.ok(`Activity set to **${ctx.opts.type} ${clip(ctx.opts.text, 120)}**.`);
    }
});

defineCommand({
    name: 'servers', category: 'owner', description: 'List the servers the bot is in',
    async execute(ctx) {
        const list = [...client.guilds.cache.values()].sort((a, b) => b.memberCount - a.memberCount);
        const lines = list.slice(0, 25).map((g, i) => `\`${i + 1}.\` **${clip(stripBrackets(g.name), 40)}** ${SYM.dot} ${fmt(g.memberCount)} members ${SYM.dot} \`${g.id}\``);
        return ctx.reply({ embeds: [createEmbed(`${SYM.star}  Servers (${list.length})`, lines.join('\n') + (list.length > 25 ? `\n*…and ${list.length - 25} more*` : ''))] });
    }
});

defineCommand({
    name: 'leaveserver', category: 'owner', description: 'Make the bot leave a server by ID',
    options: [{ name: 'server_id', type: 'string', description: 'Server ID', required: true }],
    async execute(ctx) {
        const g = client.guilds.cache.get(ctx.opts.server_id.trim());
        if (!g) return ctx.fail('I am not in a server with that ID.');
        const name = g.name;
        await g.leave();
        return ctx.ok(`Left **${stripBrackets(name)}**.`);
    }
});

defineCommand({
    name: 'blacklist', category: 'owner', description: 'Block users or servers from the bot (add / remove / list)',
    options: [
        { name: 'action', type: 'string', description: 'add, remove or list', required: true, choices: ['add', 'remove', 'list'] },
        { name: 'kind', type: 'string', description: 'user or server', required: false, choices: ['user', 'server'] },
        { name: 'id', type: 'string', description: 'User or server ID', required: false }
    ],
    example: '.blacklist add user 123456789012345678',
    async execute(ctx) {
        const { action, kind, id } = ctx.opts;
        if (action === 'list') {
            const u = botSettings.blacklistUsers, g = botSettings.blacklistGuilds;
            return ctx.reply({ embeds: [createEmbed(`${SYM.star}  Blacklist`, `**Users (${u.length})**\n${u.map(x => `\`${x}\``).join('\n') || '—'}\n\n**Servers (${g.length})**\n${g.map(x => `\`${x}\``).join('\n') || '—'}`)] });
        }
        if (!kind || !id || !/^\d{15,25}$/.test(id)) return ctx.fail('Use `.blacklist <add|remove> <user|server> <id>`.');
        if (isOwner(id)) return ctx.fail("You can't blacklist the owner.");
        const key = kind === 'user' ? 'blacklistUsers' : 'blacklistGuilds', cur = botSettings[key];
        const next = action === 'add' ? unique([...cur, id]) : cur.filter(x => x !== id);
        await saveSettings({ [key]: next });
        if (action === 'add' && kind === 'server') await client.guilds.cache.get(id)?.leave().catch(() => {});
        return ctx.ok(`${action === 'add' ? 'Blacklisted' : 'Removed'} ${kind} \`${id}\`.`);
    }
});

defineCommand({
    name: 'maintenance', category: 'owner', description: 'Maintenance mode: only the owner can use the bot',
    options: [{ name: 'state', type: 'boolean', description: 'on or off', required: true }],
    async execute(ctx) {
        await saveSettings({ maintenance: ctx.opts.state });
        return ctx.ok(`Maintenance mode **${ctx.opts.state ? 'on' : 'off'}**.`);
    }
});

defineCommand({
    name: 'givemoney', category: 'owner', description: 'Give coins to a member',
    options: [
        { name: 'user', type: 'user', description: 'Member', required: true },
        { name: 'amount', type: 'integer', description: 'Amount', required: true }
    ],
    async execute(ctx) {
        if (ctx.opts.amount === 0) return ctx.fail('Amount cannot be 0.');
        const doc = await giveCoins(ctx.guild.id, ctx.opts.user.id, ctx.opts.amount);
        return ctx.ok(`Gave **${coin(ctx.opts.amount)}** to **${ctx.opts.user.username}**. Wallet: **${coin(doc.balance)}**.`);
    }
});

defineCommand({
    name: 'setbalance', category: 'owner', description: "Set a member's wallet",
    options: [
        { name: 'user', type: 'user', description: 'Member', required: true },
        { name: 'amount', type: 'integer', description: 'New wallet amount', required: true }
    ],
    async execute(ctx) {
        if (ctx.opts.amount < 0) return ctx.fail('Amount cannot be negative.');
        await getMember(ctx.guild.id, ctx.opts.user.id);
        await Member.updateOne({ guildId: ctx.guild.id, userId: ctx.opts.user.id }, { $set: { balance: ctx.opts.amount } });
        return ctx.ok(`**${ctx.opts.user.username}**'s wallet is now **${coin(ctx.opts.amount)}**.`);
    }
});

defineCommand({
    name: 'resetuser', category: 'owner', description: "Reset a member's economy and level data in this server",
    options: [{ name: 'user', type: 'user', description: 'Member', required: true }],
    async execute(ctx) {
        const r = await Member.deleteOne({ guildId: ctx.guild.id, userId: ctx.opts.user.id });
        return r.deletedCount ? ctx.ok(`Reset **${ctx.opts.user.username}**.`) : ctx.fail('They have no data here.');
    }
});

defineCommand({
    name: 'say', category: 'owner', description: 'Make the bot say something (no pings)',
    options: [{ name: 'text', type: 'string', description: 'Message', required: true }],
    async execute(ctx) {
        await ctx.source.delete?.().catch(() => {});
        await ctx.channel.send({ content: clip(ctx.opts.text, 1900), allowedMentions: { parse: [] } });
    }
});

defineCommand({
    name: 'dm', category: 'owner', description: 'Send a DM through the bot',
    options: [
        { name: 'user', type: 'user', description: 'Recipient', required: true },
        { name: 'text', type: 'string', description: 'Message', required: true }
    ],
    async execute(ctx) {
        try { await ctx.opts.user.send({ content: clip(ctx.opts.text, 1900), allowedMentions: { parse: [] } }); }
        catch { return ctx.fail('Could not DM that user (their DMs may be closed).'); }
        return ctx.ok(`Sent a DM to **${ctx.opts.user.username}**.`);
    }
});

defineCommand({
    name: 'restart', category: 'owner', description: 'Restart the bot process (the host brings it back)',
    async execute(ctx) {
        await ctx.ok('Restarting…');
        for (const gid of [...music.keys()]) cleanupMusic(gid);
        setTimeout(() => process.exit(0), 1000);
    }
});

defineCommand({
    name: 'debug', category: 'owner', description: 'Memory, uptime, voice connections and recent errors',
    async execute(ctx) {
        const mem = process.memoryUsage();
        const errs = recentErrors.length ? recentErrors.slice(-5).map(e => `${ts(e.at)} \`${e.where}\` ${clip(e.msg, 90)}`).join('\n') : 'None';
        const e = createEmbed(`${SYM.star}  Debug`, null).addFields(
            { name: 'Uptime', value: fmtMs(Date.now() - STARTED_AT), inline: true },
            { name: 'Gateway', value: `${Math.round(client.ws.ping)}ms`, inline: true },
            { name: 'Database', value: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown', inline: true },
            { name: 'Memory', value: `RSS ${(mem.rss / 1048576).toFixed(0)} MB ${SYM.dot} Heap ${(mem.heapUsed / 1048576).toFixed(0)} MB`, inline: true },
            { name: 'Voice sessions', value: String(music.size), inline: true },
            { name: 'Servers', value: String(client.guilds.cache.size), inline: true },
            { name: 'Music', value: `SoundCloud ${scReady ? 'ready' : 'not ready'} ${SYM.dot} Spotify ${spotifyEnabled ? 'on' : 'off'} ${SYM.dot} Vinyl ${vinylUrl(false) ? 'on' : 'off'}`, inline: false },
            { name: 'Recent errors', value: errs, inline: false }
        );
        return ctx.reply({ embeds: [e] });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

function validateCommands() {
    const seen = new Map();
    for (const c of commands) {
        for (const key of [c.name, ...c.aliases]) {
            if (seen.has(key) && seen.get(key) !== c.name) console.warn(`⚠️  "${key}" is used by both "${seen.get(key)}" and "${c.name}"`);
            seen.set(key, c.name);
        }
        if (c.slash !== false && (!/^[\w-]{1,32}$/.test(c.name) || c.name !== c.name.toLowerCase())) console.warn(`⚠️  Invalid slash name: ${c.name}`);
    }
}
validateCommands();

// ═══════════════════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

client.on('error', e => logError('client', e));

client.once(Events.ClientReady, async () => {
    console.log(`✦ Velno is online as ${client.user.tag} — ${client.guilds.cache.size} servers, ${commands.filter(c => !c.hidden).length} commands`);
    applyPresence();

    const body = commands.filter(c => !c.ownerOnly && c.slash !== false).map(toSlashJson);
    if (body.length > 100) console.warn(`⚠️  ${body.length} slash commands — Discord allows 100. Extra ones are skipped.`);
    try {
        await new REST({ version: '10' }).setToken(CONFIG.TOKEN).put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: body.slice(0, 100) });
        console.log(`✅ ${Math.min(body.length, 100)} slash commands synced`);
    } catch (e) { logError('slash-sync', e); }

    initMusic().catch(() => {});
    startReminderWorker();
});

client.on(Events.GuildCreate, guild => {
    if (botSettings.blacklistGuilds.includes(guild.id)) guild.leave().catch(() => {});
});

// ─── Prefix commands, AFK and XP ─────────────────────────────────────────────
client.on(Events.MessageCreate, async message => {
    try {
        if (message.author.bot || !message.guild) return;
        const owner = isOwner(message.author.id), gid = message.guild.id;
        if (!owner && (botSettings.blacklistUsers.includes(message.author.id) || botSettings.blacklistGuilds.includes(gid))) return;

        // AFK: clear on return, announce when someone mentions an AFK user
        if (afkUsers.delete(`${gid}:${message.author.id}`)) {
            message.reply({ content: `${SYM.star} Welcome back, **${message.author.username}** — your AFK was removed.`, allowedMentions: { repliedUser: false } })
                .then(m => setTimeout(() => m.delete().catch(() => {}), 8000)).catch(() => {});
        }
        for (const [uid, u] of message.mentions.users) {
            const a = afkUsers.get(`${gid}:${uid}`);
            if (a) message.reply({ content: `${SYM.star} **${u.username}** is AFK: ${a.reason} (${ts(a.since)})`, allowedMentions: { repliedUser: false } }).catch(() => {});
        }

        const cfg = await getConfig(gid);
        const prefix = cfg.prefix || CONFIG.PREFIX;
        let content = message.content;
        const mention = new RegExp(`^<@!?${client.user.id}>\\s*`);
        if (mention.test(content)) {
            content = content.replace(mention, '');
            if (!content.trim()) return void message.reply({ content: `${SYM.star} My prefix here is \`${prefix}\` — try \`${prefix}help\`.`, allowedMentions: { repliedUser: false } }).catch(() => {});
        } else if (content.startsWith(prefix)) {
            content = content.slice(prefix.length);
        } else {
            return void grantXp(message).catch(e => logError('xp', e));
        }

        const args = content.trim().split(/ +/);
        const name = (args.shift() || '').toLowerCase();
        const cmd = commandMap.get(name);
        if (!cmd) return void grantXp(message).catch(e => logError('xp', e));
        if (cmd.ownerOnly && !owner) return;

        let opts;
        try { opts = await parsePrefixOptions(cmd, args, message); }
        catch (err) {
            if (err instanceof UsageError) return void new Ctx(message, false, cmd, {}, prefix).usage(err.message).catch(() => {});
            throw err;
        }
        await executeCommand(cmd, new Ctx(message, false, cmd, opts, prefix));
    } catch (err) { logError('messageCreate', err); }
});

// ─── Slash commands + buttons ────────────────────────────────────────────────
client.on(Events.InteractionCreate, async i => {
    try {
        if (i.isChatInputCommand()) {
            const cmd = commandMap.get(i.commandName);
            if (!cmd) return;
            if (!i.guild) return void i.reply({ content: 'Velno commands only work inside servers.', flags: MessageFlags.Ephemeral });
            const prefix = configCache.get(i.guild.id)?.prefix || CONFIG.PREFIX;
            return void (await executeCommand(cmd, new Ctx(i, true, cmd, readSlashOptions(cmd, i), prefix)));
        }
        if (i.isButton()) return void (await handleButton(i));
    } catch (err) {
        logError('interaction', err);
        if (i.isRepliable?.() && !i.replied && !i.deferred) i.reply({ content: `${SYM.no} Something went wrong.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
});

async function handleButton(i) {
    const id = i.customId;
    if (id.startsWith('help_')) return;                       // handled by the help menu's own collector

    // Music player buttons
    if (id.startsWith('np:')) {
        const state = music.get(i.guildId);
        const eph = text => i.reply({ content: `${SYM.no} ${text}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        if (!state) return eph('Nothing is playing.');
        const botVC = botVoiceChannel(i.guild)?.id;
        if (!i.member.voice?.channelId || i.member.voice.channelId !== botVC) return eph(`Join <#${botVC}> to use the controls.`);
        await i.deferUpdate().catch(() => {});
        if (id === 'np:pause') { if (state.paused) resumeTrack(state); else pauseTrack(state); }
        else if (id === 'np:skip') skipTrack(state);
        else if (id === 'np:stop') stopPlayback(state);
        else if (id === 'np:loop') setLoop(state, state.loop === 'off' ? 'track' : state.loop === 'track' ? 'queue' : 'off');
        return;
    }

    // Tickets
    if (id === 'ticket_open') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const existing = i.guild.channels.cache.find(c => c.topic === `ticket:${i.user.id}`);
        if (existing) return void i.editReply(`${SYM.no} You already have an open ticket: ${existing}`);
        const cfg = await getConfig(i.guild.id), F = PermissionsBitField.Flags;
        const overwrites = [
            { id: i.guild.id, deny: [F.ViewChannel] },
            { id: i.user.id, allow: [F.ViewChannel, F.SendMessages, F.ReadMessageHistory, F.AttachFiles] },
            { id: client.user.id, allow: [F.ViewChannel, F.SendMessages, F.ManageChannels, F.EmbedLinks] }
        ];
        if (cfg.ticketStaffRole) overwrites.push({ id: cfg.ticketStaffRole, allow: [F.ViewChannel, F.SendMessages, F.ReadMessageHistory, F.AttachFiles] });
        const name = `ticket-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90) || `ticket-${i.user.id}`;
        const ch = await i.guild.channels.create({ name, type: ChannelType.GuildText, topic: `ticket:${i.user.id}`, parent: i.channel.parentId ?? undefined, permissionOverwrites: overwrites });
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger));
        await ch.send({ content: `<@${i.user.id}>${cfg.ticketStaffRole ? ` <@&${cfg.ticketStaffRole}>` : ''}`, embeds: [createEmbed(`${SYM.star}  Welcome, ${i.user.username}`, 'Describe your issue and a staff member will be with you shortly.')], components: [row], allowedMentions: { users: [i.user.id], roles: cfg.ticketStaffRole ? [cfg.ticketStaffRole] : [] } });
        return void i.editReply(`${SYM.ok} Ticket opened: ${ch}`);
    }
    if (id === 'ticket_close') {
        const topic = i.channel.topic || '';
        if (!topic.startsWith('ticket:')) return;
        if (i.user.id !== topic.slice(7) && !i.member.permissions.has('ManageChannels')) {
            return void i.reply({ content: `${SYM.no} Only the ticket owner or staff can close this.`, flags: MessageFlags.Ephemeral });
        }
        await i.reply({ embeds: [createEmbed(null, `${SYM.star}  Closing this ticket in 5 seconds…`)] });
        setTimeout(() => i.channel.delete().catch(() => {}), 5000);
    }
}

// ─── Welcome / goodbye / auto role ───────────────────────────────────────────
client.on(Events.GuildMemberAdd, async member => {
    try {
        if (botSettings.blacklistGuilds.includes(member.guild.id)) return;
        const cfg = await getConfig(member.guild.id);
        if (cfg.autoRole) {
            const role = member.guild.roles.cache.get(cfg.autoRole);
            if (role && role.position < member.guild.members.me.roles.highest.position) await member.roles.add(role, 'Auto role').catch(() => {});
        }
        const ch = cfg.welcomeChannel && member.guild.channels.cache.get(cfg.welcomeChannel);
        if (ch?.isTextBased()) {
            await ch.send({ embeds: [createEmbed(`${SYM.star}  Welcome`, fillTemplate(cfg.welcomeMessage, member)).setThumbnail(member.displayAvatarURL({ size: 256 }))], allowedMentions: { parse: [] } });
        }
    } catch (e) { logError('member-add', e); }
});

client.on(Events.GuildMemberRemove, async member => {
    try {
        const cfg = await getConfig(member.guild.id);
        const ch = cfg.goodbyeChannel && member.guild.channels.cache.get(cfg.goodbyeChannel);
        if (ch?.isTextBased()) await ch.send({ embeds: [createEmbed(`${SYM.star}  Goodbye`, `**${member.user.username}** has left **${member.guild.name}**. We're now **${member.guild.memberCount}** members.`)], allowedMentions: { parse: [] } });
    } catch (e) { logError('member-remove', e); }
});

client.on(Events.MessageDelete, async message => {
    try {
        if (!message.guild || !message.author || message.author.bot) return;
        if (!message.content && !message.attachments?.size) return;
        const e = createEmbed(`${SYM.star}  Message Deleted`, null, THEME.WARNING).addFields(
            { name: 'Author', value: `${message.author.username} (${message.author.id})`, inline: true },
            { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Content', value: clip(message.content || `[${message.attachments.size} attachment(s)]`, 1000) }
        );
        modLog(message.guild, e);
    } catch (err) { logError('message-delete', err); }
});

// ─── Voice: leave when alone ─────────────────────────────────────────────────
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    try {
        const guild = newState.guild, state = music.get(guild.id);
        if (!state) return;
        const ch = botVoiceChannel(guild);
        if (!ch) return;
        if (humansIn(ch) === 0 && !state.stay) {
            if (!state.aloneTimer) {
                state.aloneTimer = setTimeout(() => {
                    state.aloneTimer = null;
                    if (music.get(guild.id) === state && humansIn(botVoiceChannel(guild)) === 0 && !state.stay) {
                        state.textChannel.send({ embeds: [createEmbed(null, `${SYM.star}  Everyone left — leaving the channel.`)] }).catch(() => {});
                        cleanupMusic(guild.id);
                    }
                }, IDLE_LEAVE_MS);
            }
        } else if (state.aloneTimer) { clearTimeout(state.aloneTimer); state.aloneTimer = null; }
    } catch (e) { logError('voice-state', e); }
});

// ─── Reminders ───────────────────────────────────────────────────────────────
function startReminderWorker() {
    setInterval(async () => {
        try {
            if (mongoose.connection.readyState !== 1) return;
            const due = await Reminder.find({ at: { $lte: new Date() } }).limit(25);
            for (const r of due) {
                await Reminder.deleteOne({ _id: r._id });
                const embed = createEmbed(`${SYM.star}  Reminder`, r.text);
                const ch = client.channels.cache.get(r.channelId);
                const sent = ch?.isTextBased() ? await ch.send({ content: `<@${r.userId}>`, embeds: [embed], allowedMentions: { users: [r.userId] } }).catch(() => null) : null;
                if (!sent) { const u = await client.users.fetch(r.userId).catch(() => null); await u?.send({ embeds: [embed] }).catch(() => {}); }
            }
        } catch (e) { logError('reminders', e); }
    }, 15_000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOOT — connect the database first, then log in
// ═══════════════════════════════════════════════════════════════════════════════

(async () => {
    if (!CONFIG.TOKEN) console.error('❌ DISCORD_TOKEN is missing in your environment variables.');
    if (!CONFIG.CLIENT_ID) console.error('❌ CLIENT_ID is missing — slash commands will not register.');
    if (!OWNER_IDS.length) console.warn('⚠️  OWNER_ID is not set — owner commands are disabled.');
    try {
        await mongoose.connect(CONFIG.MONGO_URI);
        console.log('🗄️  Database connected');
        await loadSettings();
    } catch (err) { logError('mongo', err); }
    await client.login(CONFIG.TOKEN);
})();
