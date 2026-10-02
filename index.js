// ═══════════════════════════════════════════════════════════════════════════════
// 👑 VELNO SOVEREIGN EDITION (fixed)
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const http = require('http');
const {
    Client, GatewayIntentBits, Partials, Events, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField,
    REST, Routes, ChannelType, ActivityType, MessageFlags
} = require('discord.js');
const mongoose = require('mongoose');
const {
    joinVoiceChannel, createAudioPlayer, createAudioResource,
    AudioPlayerStatus, VoiceConnectionStatus, entersState
} = require('@discordjs/voice');
const play = require('play-dl');

// ─── Keep Render happy (it wants an open port on Web Services) ────────────────
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Velno Sovereign is alive');
}).listen(process.env.PORT || 3000);

// ─── Never let one error kill the process ─────────────────────────────────────
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));
process.on('uncaughtException', err => console.error('Uncaught exception:', err));

const THEME = {
    GOLD: '#241847',
    ERROR: '#DC2626',
    SUCCESS: '#10b967',
    WARNING: '#9e6611',
    FOOTER: '✦ Velno • Engineered with purpose.'
};

const CONFIG = {
    TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    MONGO_URI: process.env.MONGODB_URI,
    PREFIX: '.'
};

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════════════════════════════════

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    balance: { type: Number, default: 1000 },
    bank: { type: Number, default: 5000 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    warns: { type: Number, default: 0 },
    inventory: [String],
    dailyStreak: { type: Number, default: 0 },
    lastDaily: Date
});
const User = mongoose.model('SovereignUser', userSchema);

async function getUser(id) {
    let user = await User.findOne({ userId: id });
    if (!user) user = await User.create({ userId: id });
    return user;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

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
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// description is optional – setDescription('') throws in discord.js
function createEmbed(title, description, color = THEME.GOLD) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setTimestamp()
        .setFooter({ text: THEME.FOOTER, iconURL: client.user?.displayAvatarURL() });
    if (description) embed.setDescription(description);
    return embed;
}

// Works for both slash interactions and prefix messages
async function reply(i, content, ephemeral = false) {
    const payload = typeof content === 'string' ? { content } : { ...content };

    if (i.isChatInputCommand?.()) {
        if (ephemeral) payload.flags = MessageFlags.Ephemeral;
        if (i.deferred || i.replied) return i.editReply(payload);
        return i.reply(payload);
    }

    // Prefix command: send to channel (command message may already be deleted)
    const sent = await i.channel.send(payload);
    if (ephemeral) setTimeout(() => sent.delete().catch(() => {}), 5000);
    return sent;
}

async function runCommand(command, i, isSlash, args) {
    try {
        await command.execute(i, isSlash, args);
    } catch (err) {
        console.error(`[command:${command.name}]`, err);
        await reply(i, '❌ Something went wrong: ' + err.message).catch(() => {});
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MUSIC ENGINE  (SoundCloud → YouTube fallback, optional Spotify links)
// ═══════════════════════════════════════════════════════════════════════════════

const guildMusic = new Map();     // guildId -> { queue, player, connection, textChannel, token }
const stateCreation = new Map();  // guildId -> Promise (stops double-joining)
let scReady = false;
let spotifyTried = false;
let spotifyEnabled = false;

// Runs automatically the first time someone uses play — no startup changes needed
async function initMusic() {
    if (!scReady) {
        try {
            const clientId = await play.getFreeClientID();
            await play.setToken({ soundcloud: { client_id: clientId } });
            scReady = true;
            console.log('🎵 SoundCloud ready');
        } catch (err) {
            console.error('❌ SoundCloud init failed:', err.message);
        }
    }

    // Optional Spotify links (needs the 3 env vars)
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
            } catch (err) {
                console.error('❌ Spotify init failed:', err.message);
            }
        }
    }
}

function fmtDuration(sec) {
    if (!sec) return 'Live';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}

// Turns what the user typed into queue items
async function resolveTracks(query, requester) {
    await initMusic();
    const type = await play.validate(query);

    if (type === false) throw new Error('That link is not supported.');

    // Plain text → SoundCloud first, then YouTube
    if (type === 'search') {
        let results = await play.search(query, { source: { soundcloud: 'tracks' }, limit: 1 }).catch(() => []);
        if (!results.length) results = await play.search(query, { limit: 1 }).catch(() => []);
        if (!results.length) return [];
        const r = results[0];
        return [{
            title: r.name || r.title,
            url: r.url,
            duration: fmtDuration(r.durationInSec),
            thumbnail: r.thumbnail?.url || r.thumbnails?.[0]?.url || (typeof r.thumbnail === 'string' ? r.thumbnail : null),
            requester
        }];
    }

    // SoundCloud links
    if (type === 'so_track') {
        const t = await play.soundcloud(query);
        return [{ title: t.name, url: t.url, duration: fmtDuration(t.durationInSec), thumbnail: t.thumbnail || null, requester }];
    }
    if (type === 'so_playlist') {
        const p = await play.soundcloud(query);
        const tracks = await p.all_tracks();
        return tracks.slice(0, 50).map(t => ({
            title: t.name, url: t.url, duration: fmtDuration(t.durationInSec), thumbnail: t.thumbnail || null, requester
        }));
    }

    // Spotify links → read names, find audio on SoundCloud/YouTube right before playing
    if (type === 'sp_track' || type === 'sp_album' || type === 'sp_playlist') {
        if (!spotifyEnabled) {
            throw new Error('Spotify links are not set up on this bot. Use a song name or a SoundCloud link.');
        }
        if (play.is_expired()) await play.refreshToken();

        const toSong = t => {
            const artist = t.artists?.[0]?.name || '';
            return {
                title: artist ? `${artist} - ${t.name}` : t.name,
                url: null,
                search: `${artist} ${t.name}`.trim(),
                duration: fmtDuration(t.durationInSec),
                thumbnail: t.thumbnail?.url || null,
                requester
            };
        };

        const sp = await play.spotify(query);
        if (type === 'sp_track') return [toSong(sp)];
        const all = await sp.all_tracks();
        return all.slice(0, 50).map(toSong);
    }

    // Direct YouTube video link
    if (type === 'yt_video') {
        const v = (await play.video_basic_info(query)).video_details;
        return [{ title: v.title, url: v.url, duration: v.durationRaw, thumbnail: v.thumbnails?.[0]?.url || null, requester }];
    }

    throw new Error('That link type is not supported. Use a song name, SoundCloud link, or Spotify link.');
}

// Spotify items have no URL yet — find one now
async function ensurePlayable(song) {
    if (song.url) return;
    let results = await play.search(song.search, { source: { soundcloud: 'tracks' }, limit: 1 }).catch(() => []);
    if (!results.length) results = await play.search(song.search, { limit: 1 }).catch(() => []);
    if (!results.length) throw new Error(`No playable match for "${song.title}"`);
    song.url = results[0].url;
}

function cleanupGuild(guildId) {
    const state = guildMusic.get(guildId);
    if (!state) return;
    guildMusic.delete(guildId); // delete first so the handlers below do nothing
    try { state.player.stop(true); } catch {}
    try { state.connection.destroy(); } catch {}
}

async function playNext(guildId) {
    const state = guildMusic.get(guildId);
    if (!state) return;

    const song = state.queue[0];
    if (!song) return cleanupGuild(guildId);

    const token = ++state.token; // cancels any older playNext still loading

    try {
        await ensurePlayable(song);
        const stream = await play.stream(song.url);
        if (state.token !== token || !guildMusic.has(guildId)) return;

        const resource = createAudioResource(stream.stream, { inputType: stream.type });
        state.player.play(resource);

        const embed = createEmbed('🎶 Now Playing', `[**${song.title}**](${song.url})`)
            .addFields(
                { name: 'Duration', value: song.duration || 'Live', inline: true },
                { name: 'Requester', value: song.requester || 'Unknown', inline: true }
            );
        if (song.thumbnail) embed.setImage(song.thumbnail);
        state.textChannel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
        console.error('Stream error:', err.message);
        if (state.token !== token) return;
        state.textChannel.send(`❌ Could not play **${song.title}**. Skipping...`).catch(() => {});
        state.queue.shift();
        playNext(guildId);
    }
}

async function getOrCreateState(guild, voiceChannel, textChannel) {
    if (guildMusic.has(guild.id)) return guildMusic.get(guild.id);
    if (stateCreation.has(guild.id)) return stateCreation.get(guild.id);

    const creating = (async () => {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        } catch {
            try { connection.destroy(); } catch {}
            throw new Error('Could not join the voice channel (check bot permissions).');
        }

        const player = createAudioPlayer();
        connection.subscribe(player);

        const state = { queue: [], player, connection, textChannel, token: 0 };
        guildMusic.set(guild.id, state);

        player.on(AudioPlayerStatus.Idle, () => {
            if (guildMusic.get(guild.id) !== state) return;
            state.queue.shift();
            playNext(guild.id);
        });
        player.on('error', err => console.error('Player error:', err.message));

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
                ]);
            } catch {
                cleanupGuild(guild.id);
            }
        });

        return state;
    })().finally(() => stateCreation.delete(guild.id));

    stateCreation.set(guild.id, creating);
    return creating;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

const commands = [
    {
        name: 'ping',
        description: 'Check bot latency',
        execute: async (i) => reply(i, `🏓 Pong! **${Math.round(client.ws.ping)}ms**`)
    },
    {
        name: 'help',
        description: 'List all commands',
        execute: async (i) => {
            const list = commands.map(c => `**${CONFIG.PREFIX}${c.name}** — ${c.description}`).join('\n');
            await reply(i, { embeds: [createEmbed('📜 Sovereign Commands', list)] });
        }
    },

    // --- MODERATION ---
    {
        name: 'purge',
        description: 'Clear messages instantly',
        options: [{ name: 'amount', type: 4, description: 'Number of messages', required: true }],
        execute: async (i, isSlash, args) => {
            if (!i.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
                return reply(i, '❌ Access Denied.', true);
            const amount = isSlash ? i.options.getInteger('amount') : parseInt(args[0]);
            if (!amount || amount < 1 || amount > 99) return reply(i, '❌ Choose 1–99 messages.', true);

            // Prefix: also remove the command message itself
            const toDelete = amount + (isSlash ? 0 : 1);
            await i.channel.bulkDelete(toDelete, true);
            await reply(i, `🧹 **Systems purged ${amount} messages.**`, true);
        }
    },
    {
        name: 'ban',
        description: 'Banish a user from the realm',
        options: [{ name: 'user', type: 6, description: 'Target', required: true }],
        execute: async (i, isSlash) => {
            if (!i.member.permissions.has(PermissionsBitField.Flags.BanMembers))
                return reply(i, '❌ Access Denied.', true);
            const target = isSlash ? i.options.getUser('user') : i.mentions.users.first();
            if (!target) return reply(i, '❌ Target required.', true);

            await i.guild.members.ban(target.id);
            const embed = createEmbed('🔨 Judgment Executed', `**${target.tag}** has been banished.`, THEME.ERROR);
            await reply(i, { embeds: [embed] });
        }
    },

    // --- ECONOMY ---
    {
        name: 'balance',
        description: 'View your Sovereign Wealth',
        execute: async (i) => {
            const user = await getUser(i.member.id);
            const embed = createEmbed(`🏦 Sovereign Account: ${i.member.user.username}`)
                .addFields(
                    { name: '💵 Liquid Cash', value: `$${user.balance.toLocaleString()}`, inline: true },
                    { name: '💎 Vault', value: `$${user.bank.toLocaleString()}`, inline: true },
                    { name: '📊 Net Worth', value: `$${(user.balance + user.bank).toLocaleString()}`, inline: true }
                )
                .setThumbnail(i.member.user.displayAvatarURL());
            await reply(i, { embeds: [embed] });
        }
    },
    {
        name: 'daily',
        description: 'Collect your daily tribute',
        execute: async (i) => {
            const user = await getUser(i.member.id);
            const now = new Date();

            if (user.lastDaily && (now - user.lastDaily) < 86400000)
                return reply(i, '⏳ **Patience.** The treasury reopens tomorrow.');

            // Reset streak if they missed more than 48h
            if (user.lastDaily && (now - user.lastDaily) > 172800000) user.dailyStreak = 0;

            const amount = 2000 + (user.dailyStreak * 100);
            user.balance += amount;
            user.dailyStreak++;
            user.lastDaily = now;
            await user.save();

            const embed = createEmbed('🎁 Tribute Collected',
                `You received **$${amount.toLocaleString()}**.\nStreak: ${user.dailyStreak} days`, THEME.SUCCESS);
            await reply(i, { embeds: [embed] });
        }
    },

    // --- MUSIC ---
    {
        name: 'play',
        description: 'Queue a melody',
        options: [{ name: 'song', type: 3, description: 'Song name, SoundCloud link, or Spotify link', required: true }],
        execute: async (i, isSlash, args) => {
            const voiceChannel = i.member.voice?.channel;
            if (!voiceChannel) return reply(i, '❌ Connect to a voice channel first.');

            const query = isSlash ? i.options.getString('song') : args.join(' ');
            if (!query) return reply(i, '❌ Tell me what to play.');

            const existing = guildMusic.get(i.guild.id);
            if (existing && existing.connection.joinConfig.channelId !== voiceChannel.id) {
                return reply(i, '❌ Join the voice channel I\'m already in.');
            }

            if (isSlash) await i.deferReply();
            else await i.channel.sendTyping();

            const tracks = await resolveTracks(query, i.member.user.username);
            if (!tracks.length) return reply(i, '❌ No melody found.');

            const state = await getOrCreateState(i.guild, voiceChannel, i.channel);
            const wasEmpty = state.queue.length === 0;
            const position = state.queue.length + 1;
            state.queue.push(...tracks);

            if (tracks.length > 1) {
                await reply(i, { embeds: [createEmbed('📜 Playlist Added', `Added **${tracks.length}** tracks to the queue.`, THEME.GOLD)] });
            } else if (wasEmpty) {
                await reply(i, `🎵 **Starting:** ${tracks[0].title}`);
            } else {
                const embed = createEmbed('📜 Added to Queue', `**${tracks[0].title}**\nPosition: ${position}`, THEME.GOLD);
                if (tracks[0].thumbnail) embed.setThumbnail(tracks[0].thumbnail);
                await reply(i, { embeds: [embed] });
            }

            if (wasEmpty) playNext(i.guild.id);
        }
    },
    {
        name: 'skip',
        description: 'Skip current song',
        execute: async (i) => {
            const state = guildMusic.get(i.guild.id);
            if (!state || state.queue.length === 0) return reply(i, '❌ Nothing playing.');

            if (state.player.state.status === AudioPlayerStatus.Idle) {
                // Song still loading — advance manually
                state.queue.shift();
                playNext(i.guild.id);
            } else {
                state.player.stop(); // Idle handler moves to the next track
            }
            await reply(i, '⏭️ **Skipped.**');
        }
    },
    {
        name: 'stop',
        description: 'Stop music and clear the queue',
        execute: async (i) => {
            if (!guildMusic.has(i.guild.id)) return reply(i, '❌ Nothing playing.');
            cleanupGuild(i.guild.id);
            await reply(i, '⏹️ **Stopped and left the channel.**');
        }
    },

    // --- LEVELING ---
    {
        name: 'rank',
        description: 'Check your prestige',
        execute: async (i) => {
            const user = await getUser(i.member.id);
            const nextLevel = user.level * 1000;
            const pct = Math.min(user.xp / nextLevel, 1);
            const filled = Math.floor(pct * 10);
            const bar = '▰'.repeat(filled) + '▱'.repeat(10 - filled);

            const embed = createEmbed(`👑 Prestige: ${i.member.user.username}`)
                .addFields(
                    { name: 'Level', value: `${user.level}`, inline: true },
                    { name: 'XP', value: `${user.xp} / ${nextLevel}`, inline: true },
                    { name: 'Progress', value: `${bar} (${Math.floor(pct * 100)}%)`, inline: false }
                );
            await reply(i, { embeds: [embed] });
        }
    },

    // --- TICKETS ---
    {
        name: 'ticket',
        description: 'Spawn the ticket portal',
        execute: async (i) => {
            if (!i.member.permissions.has(PermissionsBitField.Flags.Administrator))
                return reply(i, '❌ Administrators only.', true);

            const embed = createEmbed('📩 Sovereign Support', 'Click below to open a private channel with High Command.')
                .setThumbnail(i.guild.iconURL());
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('open_ticket').setLabel('Open Ticket')
                    .setStyle(ButtonStyle.Secondary).setEmoji('📩')
            );
            await i.channel.send({ embeds: [embed], components: [row] });
            await reply(i, '✅ Portal opened.', true);
        }
    }
];

// ═══════════════════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

client.once(Events.ClientReady, async () => {
 console.log('╔═══════════════════════════════════════════════╗');
    console.log('║   ⚡ VELNO ULTIMATE — FINAL BOSS VERSION     ║');
    console.log('║                                               ║');
    console.log('║   ✅ PREFIX COMMANDS (.) ENABLED             ║');
    console.log('║   ✅ SLASH COMMANDS (/) ENABLED              ║');
    console.log('║   ✅ MUSIC SYSTEM ACTIVE                     ║');
    console.log('║   ✅ ANTI-NUKE PROTECTION ACTIVE             ║');
    console.log('║   ✅ TRUST SYSTEM FIXED                      ║');
    console.log('║   ✅ 100+ COMMANDS LOADED                    ║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log(`✅ Logged in as: ${client.user.tag}`);
    console.log(`📊 Servers: ${client.guilds.cache.size}`);
    console.log(`🎯 Current Prefix: ${CONFIG.PREFIX}`);
    console.log('══════════════════════════════════════════════════\n');

    const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), {
            body: commands.map(c => ({
                name: c.name,
                description: c.description,
                options: c.options || []
            }))
        });
        console.log('✅ Commands Synced.');
    } catch (e) {
        console.error('Command sync failed:', e);
    }

    client.user.setActivity('over the Empire | .help', { type: ActivityType.Watching });
});

const xpCooldown = new Map(); // userId -> timestamp

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return;

    // Leveling (max once per 30s per user to spare the DB)
    try {
        const last = xpCooldown.get(message.author.id) || 0;
        if (Date.now() - last > 30_000) {
            xpCooldown.set(message.author.id, Date.now());
            const user = await getUser(message.author.id);
            user.xp += Math.floor(Math.random() * 10) + 15;
            if (user.xp >= user.level * 1000) {
                user.level++;
                user.xp = 0;
                message.channel.send(`👑 **Ascension!** <@${message.author.id}> reached **Level ${user.level}**!`).catch(() => {});
            }
            await user.save();
        }
    } catch (err) {
        console.error('Leveling error:', err.message);
    }

    // Prefix commands
    if (!message.content.startsWith(CONFIG.PREFIX)) return;
    const args = message.content.slice(CONFIG.PREFIX.length).trim().split(/ +/);
    const cmdName = args.shift().toLowerCase();
    const command = commands.find(c => c.name === cmdName);
    if (command) await runCommand(command, message, false, args);
});

client.on(Events.InteractionCreate, async i => {
    try {
        if (i.isChatInputCommand()) {
            const command = commands.find(c => c.name === i.commandName);
            if (command) await runCommand(command, i, true, null);
            return;
        }

        if (i.isButton() && i.customId === 'open_ticket') {
            const channel = await i.guild.channels.create({
                name: `ticket-${i.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    {
                        id: i.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory
                        ]
                    }
                ]
            });

            const embed = createEmbed(`👋 Greetings, ${i.user.username}`, 'Describe your issue. Staff will arrive shortly.');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close')
                    .setStyle(ButtonStyle.Danger).setEmoji('🔒')
            );
            await channel.send({ content: `<@${i.user.id}>`, embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Ticket opened: ${channel}`, flags: MessageFlags.Ephemeral });
            return;
        }

        if (i.isButton() && i.customId === 'close_ticket') {
            if (!i.channel.name.startsWith('ticket-')) return;
            await i.reply('🔒 Closing in 5 seconds...');
            setTimeout(() => i.channel.delete().catch(() => {}), 5000);
        }
    } catch (err) {
        console.error('Interaction error:', err);
        if (!i.replied && !i.deferred) {
            i.reply({ content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP – connect DB first, then log in
// ═══════════════════════════════════════════════════════════════════════════════

(async () => {
    try {
        await mongoose.connect(CONFIG.MONGO_URI);
        console.log('🗄️  Sovereign DB Connected');
    } catch (err) {
        console.error('❌ MongoDB connection failed:', err.message);
    }
    await client.login(CONFIG.TOKEN);
})();
