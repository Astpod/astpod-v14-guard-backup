const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, AuditLogEvent, StringSelectMenuBuilder, ComponentType } = require("discord.js");
const winston = require('winston');
const client = global.client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});
const mongoose = require("mongoose");
const Config = require("./config.json");
const RoleModel = require("./models/roleModel.js");
const ChannelModel = require("./models/channelModel.js");
const SafeMember = require("./models/safeMember.js");

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'hata.log', level: 'error' }),
        new winston.transports.File({ filename: 'tum.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

async function sendLog(title, description, type = "info") {
    try {
        const logChannel = client.channels.cache.get(Config.LOG_CHANNEL);
        if (!logChannel) {
            logger.warn("Log kanalı bulunamadı!");
            return;
        }

        const embed = new EmbedBuilder()
            .setAuthor({ 
                name: "Astpod Guard", 
                iconURL: client.user?.displayAvatarURL({ dynamic: true }) || null
            })
            .setTitle(title)
            .setDescription(`\`\`\`md\n# ${description}\`\`\``)
            .setTimestamp()
            .setFooter({ 
                text: `Astpod Guard • ${new Date().toLocaleString('tr-TR')}`, 
                iconURL: client.user?.displayAvatarURL({ dynamic: true }) || null
            })
            .setColor(
                type === "error" ? "#ff0000" : 
                type === "success" ? "#00ff00" : 
                type === "warning" ? "#ffff00" : 
                "#0099ff"
            );

        switch(type) {
            case "error":
                embed.setTitle(`⛔ ${title}`)
                    .setDescription(`\`\`\`- ${description}\`\`\``)
                break;
            case "success":
                embed.setTitle(`✅ ${title}`)
                    .setDescription(`\`\`\`\n+ ${description}\`\`\``)
                break;
            case "warning":
                embed.setTitle(`⚠️ ${title}`)
                    .setDescription(`\`\`\`fix\n! ${description}\`\`\``)
                break;
            default:
                embed.setTitle(`ℹ️ ${title}`)
                    .setDescription(`\`\`\`md\n# ${description}\`\`\``)
        }

        if (logChannel) {
            await logChannel.send({ embeds: [embed] }).catch(err => {
                logger.error("Log mesajı gönderme hatası:", err);
            });
        }
        
        const logMessage = `[${type.toUpperCase()}] ${title}: ${description}`;
        switch(type) {
            case "error":
                logger.error(logMessage);
                break;
            case "warning":
                logger.warn(logMessage);
                break;
            case "success":
                logger.info(logMessage);
                break;
            default:
                logger.info(logMessage);
        }
    } catch (error) {
        logger.error("Log gönderme hatası:", error);
    }
}

mongoose.connect(Config.MONGO_URL, {
    useNewUrlParser: true,
    autoIndex: true,
    family: 4,
    useUnifiedTopology: true,
    noDelay: true,
    autoCreate: true
}).then(x => {
    logger.info("[Astpod] MongoDB bağlantısı başarılı!");
    sendLog("MongoDB Bağlantısı", "MongoDB veritabanına başarıyla bağlanıldı!", "success");
}).catch(err => {
    logger.error("[Astpod] MongoDB bağlantı hatası!", err);
    sendLog("MongoDB Hatası", "MongoDB veritabanına bağlanılamadı!", "error");
});

client.once("ready", async () => {
    logger.info("[Astpod] Bot aktif!");
    sendLog("Bot Durumu", "Bot başarıyla aktif edildi!", "success");
    
    try {
        await client.user.setPresence({ 
            activities: [{ 
                name: Config.STATUS,
                type: 0
            }],
            status: 'online'
        });
    } catch (error) {
        logger.error("Presence ayarlama hatası:", error);
    }
    
    await getBackup();
    setInterval(async () => {
        await getBackup();
    }, 1000 * 60 * 60 * 2);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || !message.content.toLowerCase().startsWith(Config.PREFIX)) return;
    if (!Config.OWNER.includes(message.author.id)) return;
    
    let args = message.content.split(' ').slice(1);
    let command = message.content.split(' ')[0].slice(Config.PREFIX.length);
    
    const embed = new EmbedBuilder()
        .setColor("#2F3136")
        .setAuthor({ 
            name: "Astpod Guard", 
            iconURL: client.user?.displayAvatarURL({ dynamic: true }) || null 
        })
        .setFooter({ 
            text: `Astpod Guard • ${new Date().toLocaleString('tr-TR')}`, 
            iconURL: client.user?.displayAvatarURL({ dynamic: true }) || null 
        });
    
    if ((Config.OWNER.includes(message.author.id)) && (command === "menu" || command === "guard-menu" || command === "backup")) {
        const row = new ActionRowBuilder().addComponents([
            new StringSelectMenuBuilder()
                .setCustomId('guard_menu')
                .setPlaceholder('Bir işlem seçin')
                .addOptions([
                    {
                        label: 'Rolleri Kur',
                        description: 'Silinen rolleri geri yükler',
                        value: 'roles',
                        emoji: '👑'
                    },
                    {
                        label: 'Kanal ve Kategorileri Kur',
                        description: 'Silinen kanalları geri yükler',
                        value: 'channels',
                        emoji: '📝'
                    }
                ])
        ]);

        const question = await message.channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor("#2F3136")
                    .setDescription("Guard menüsünden yapmak istediğiniz işlemi seçin.")
            ],
            components: [row]
        });

        const collector = question.createMessageComponentCollector({ 
            time: 300000,
            filter: i => i.user.id === message.author.id
        });

        collector.on("collect", async (interaction) => {
            try {
                if (interaction.user.id !== message.author.id) {
                    return interaction.reply({
                        content: "Bu menüyü sadece komutu kullanan kişi kullanabilir!",
                        ephemeral: true
                    });
                }

                await interaction.deferUpdate();

                const selected = interaction.values[0];
                if (selected === "roles") {
                    await interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor("Green")
                                .setDescription("Rol kurma işlemi başlatılıyor...")
                        ],
                        components: []
                    });
                    await checkRoles(question, row);
                } else if (selected === "channels") {
                    await interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor("Green")
                                .setDescription("Kanal kurma işlemi başlatılıyor...")
                        ],
                        components: []
                    });
                    await checkChannels(question, row);
                }
            } catch (error) {
                console.error("Menü etkileşimi hatası:", error);
                await question.edit({
                    embeds: [
                        new EmbedBuilder()
                            .setColor("Red")
                            .setDescription("İşlem sırasında bir hata oluştu. Lütfen daha sonra tekrar deneyin.")
                    ],
                    components: []
                }).catch(() => {});
            }
        });

        collector.on("end", () => {
            question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Menü süresi doldu. Yeni bir komut kullanabilirsiniz.")
                ],
                components: []
            }).catch(() => {});
        });
    } else if (Config.OWNER.includes(message.author.id) && (command === "safe" || command === "safes" || command === "güvenli" || command === "guvenli")) {
        let ast = args[0];
        if (!ast) return;
        
        if (ast === "ekle") {
            if (!args[1]) {
                message.channel.send({embeds: [embed.setDescription(`**Güvenli eklemek için geçerli bir kullanıcı belirtmelisin ve çıkan menüden bir seçenek seçmelisin.**`)]})
            } else {
                let dats = args[1] ? (message.guild.members.cache.get(args[1].replace(/\D/g, '')) || message.guild.roles.cache.get(args[1].replace(/\D/g, ''))) : undefined;
                if (!dats) return message.reply({embeds: [embed.setDescription("Lütfen bir rol ID'si giriniz veya Rol Etiketleyiniz!")]})
                const row = new ActionRowBuilder().addComponents([
                    new StringSelectMenuBuilder()
                        .setCustomId('safe_menu')
                        .setPlaceholder('Güvenli türünü seçin')
                        .addOptions([
                            {
                                label: 'Full Yetki',
                                description: 'Tüm yetkileri içerir',
                                value: 'full',
                                emoji: '🔰'
                            },
                            {
                                label: 'Owner Yetki',
                                description: 'Sahip yetkilerini içerir',
                                value: 'owner',
                                emoji: '👑'
                            },
                            {
                                label: 'Rol Yetki',
                                description: 'Rol yönetimi yetkilerini içerir',
                                value: 'rol',
                                emoji: '🎭'
                            },
                            {
                                label: 'Kanal Yetki',
                                description: 'Kanal yönetimi yetkilerini içerir',
                                value: 'kanal',
                                emoji: '📝'
                            },
                            {
                                label: 'Ban ve Kick Yetki',
                                description: 'Ban ve Kick yetkilerini içerir',
                                value: 'bankick',
                                emoji: '⚡'
                            }
                        ])
                ]);
                const question = await message.channel.send({
                    content: 'Kullanıcıyı hangi güvenli kategorisine eklemek istediğinizi seçin.',
                    components: [row],
                });

                const collector = question.createMessageComponentCollector({
                    componentType: ComponentType.StringSelect,
                    time: 300000
                });

                collector.on("collect", async (interaction) => {
                    try {
                        if (interaction.user.id !== message.author.id) {
                            return interaction.reply({
                                content: "Bu menüyü sadece komutu kullanan kişi kullanabilir!",
                                ephemeral: true
                            });
                        }

                        await interaction.deferUpdate();

                        if (interaction.values[0] === "full") {
                            await checkFull(question, row, dats);
                        } else if (interaction.values[0] === "owner") {
                            await checkOwner(question, row, dats);
                        } else if (interaction.values[0] === "rol") {
                            await checkRol(question, row, dats);
                        } else if (interaction.values[0] === "kanal") {
                            await checkChannel(question, row, dats);
                        } else if (interaction.values[0] === "bankick") {
                            await checkBanKick(question, row, dats);
                        }
                    } catch (error) {
                        console.error("Menü etkileşimi hatası:", error);
                        await question.edit({
                            content: 'İşlem sırasında bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
                            components: [],
                        }).catch(() => {});
                    }
                });

                collector.on("end", () => {
                    try {
                        question.edit({
                            content: 'Menü süresi doldu. Yeni bir komut kullanabilirsiniz.',
                            components: [],
                        }).catch(() => {});
                    } catch (error) {
                        console.error("Menü sonlandırma hatası:", error);
                    }
                });
            }
        } else if (ast === "çıkar") {
            if (!args[1]) {
                message.channel.send({embeds: [embed.setDescription(`**Güvenli listeden çıkarmak için geçerli bir kullanıcı belirtmelisin ve çıkan menüden bir seçenek seçmelisin.**`)]})
            } else {
                let dats = args[1] ? (message.guild.members.cache.get(args[1].replace(/\D/g, '')) || message.guild.roles.cache.get(args[1].replace(/\D/g, ''))) : undefined;
                if (!dats) return message.reply({embeds: [embed.setDescription("Lütfen bir rol ID'si giriniz veya Rol Etiketleyiniz!")]})
                const row = new ActionRowBuilder().addComponents([
                    new StringSelectMenuBuilder()
                        .setCustomId('safe_menu_remove')
                        .setPlaceholder('Güvenli türünü seçin')
                        .addOptions([
                            {
                                label: 'Full Yetki',
                                description: 'Tüm yetkileri içerir',
                                value: 'full',
                                emoji: '🔰'
                            },
                            {
                                label: 'Owner Yetki',
                                description: 'Sahip yetkilerini içerir',
                                value: 'owner',
                                emoji: '👑'
                            },
                            {
                                label: 'Rol Yetki',
                                description: 'Rol yönetimi yetkilerini içerir',
                                value: 'rol',
                                emoji: '🎭'
                            },
                            {
                                label: 'Kanal Yetki',
                                description: 'Kanal yönetimi yetkilerini içerir',
                                value: 'kanal',
                                emoji: '📝'
                            },
                            {
                                label: 'Ban ve Kick Yetki',
                                description: 'Ban ve Kick yetkilerini içerir',
                                value: 'bankick',
                                emoji: '⚡'
                            }
                        ])
                ]);
                const question = await message.channel.send({
                    content: 'Kullanıcıyı hangi güvenli kategorisinden çıkarmak istediğinizi seçin.',
                    components: [row],
                });

                const collector = question.createMessageComponentCollector({
                    componentType: ComponentType.StringSelect,
                    time: 300000
                });

                collector.on("collect", async (interaction) => {
                    try {
                        if (interaction.user.id !== message.author.id) {
                            return interaction.reply({
                                content: "Bu menüyü sadece komutu kullanan kişi kullanabilir!",
                                ephemeral: true
                            });
                        }

                        await interaction.deferUpdate();

                        if (interaction.values[0] === "full") {
                            await removeFull(question, row, dats);
                        } else if (interaction.values[0] === "owner") {
                            await removeOwner(question, row, dats);
                        } else if (interaction.values[0] === "rol") {
                            await removeRol(question, row, dats);
                        } else if (interaction.values[0] === "kanal") {
                            await removeChannel(question, row, dats);
                        } else if (interaction.values[0] === "bankick") {
                            await removeBanKick(question, row, dats);
                        }
                    } catch (error) {
                        console.error("Menü etkileşimi hatası:", error);
                        await question.edit({
                            content: 'İşlem sırasında bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
                            components: [],
                        }).catch(() => {});
                    }
                });

                collector.on("end", () => {
                    try {
                        question.edit({
                            content: 'Menü süresi doldu. Yeni bir komut kullanabilirsiniz.',
                            components: [],
                        }).catch(() => {});
                    } catch (error) {
                        console.error("Menü sonlandırma hatası:", error);
                    }
                });
            }
        } else if (ast === "liste") {
            let astpodxd = await SafeMember.findOne({guildID: Config.GUILD_ID})
            let description = "**Full Güvenliler;**\n";
            description += astpodxd?.Full?.length > 0 ? astpodxd.Full.map(x => message.guild.members.cache.get(x) || message.guild.roles.cache.get(x)).join("\n") : "`Full Güvenlisinde bulunan kişi yok.`";
            description += "\n\n**Owner Güvenliler;**\n";
            description += astpodxd?.Owner?.length > 0 ? astpodxd.Owner.map(x => message.guild.members.cache.get(x) || message.guild.roles.cache.get(x)).join("\n") : "`Owner Güvenlisinde bulunan kişi yok.`";
            description += "\n\n**Rol Güvenliler;**\n";
            description += astpodxd?.Role?.length > 0 ? astpodxd.Role.map(x => message.guild.members.cache.get(x) || message.guild.roles.cache.get(x)).join("\n") : "`Rol Güvenlisinde bulunan kişi yok.`";
            description += "\n\n**Kanal Güvenliler;**\n";
            description += astpodxd?.Channel?.length > 0 ? astpodxd.Channel.map(x => message.guild.members.cache.get(x) || message.guild.roles.cache.get(x)).join("\n") : "`Kanal Güvenlisinde bulunan kişi yok.`";
            description += "\n\n**Ban Ve Kick Güvenliler;**\n";
            description += astpodxd?.BanAndKick?.length > 0 ? astpodxd.BanAndKick.map(x => message.guild.members.cache.get(x) || message.guild.roles.cache.get(x)).join("\n") : "`Ban Ve Kick Güvenlisinde bulunan kişi yok.`";

            const embed = new EmbedBuilder()
                .setColor("Random")
                .setDescription(description);

            await message.channel.send({ embeds: [embed] });
        }
    }
});

client.on("roleDelete", async (role) => {
    try {
        const logs = await role.guild.fetchAuditLogs({ 
            limit: 1, 
            type: AuditLogEvent.RoleDelete 
        });
        const entry = logs.entries.first();
        
        if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
        
        const member = await role.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member?.bannable) {
            await punish(client, member.id, "kick");
            sendLog("🛡️ Rol Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı ${role.name} rolünü silmeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
        }
    } catch (error) {
        logger.error("Rol silme olayı hatası:", error);
    }
});

client.on("roleCreate", async (role) => {
    try {
        const logs = await role.guild.fetchAuditLogs({ 
            limit: 1, 
            type: AuditLogEvent.RoleCreate 
        });
        const entry = logs.entries.first();
        
        if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
        
        const member = await role.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member?.bannable) {
            await punish(client, member.id, "kick");
            await role.delete({ reason: "[Astpod] İzinsiz rol oluşturma" });
            sendLog("🛡️ Rol Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı izinsiz rol oluşturmaya çalıştı!\n- İşlem otomatik olarak engellendi\n- Oluşturulan rol silindi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
        }
    } catch (error) {
        logger.error("Rol oluşturma olayı hatası:", error);
    }
});

client.on("roleUpdate", async (oldRole, newRole) => {
  try {
    const logs = await oldRole.guild.fetchAuditLogs({ 
      limit: 1, 
      type: AuditLogEvent.RoleUpdate 
    });
    const entry = logs.entries.first();
  if ((!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner"))) return;
    const member = await oldRole.guild.members.fetch(entry.executor.id).catch(() => null);
    if (member?.bannable) {
      await punish(client, member.id, "kick");
      sendLog("🛡️ Rol Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı ${oldRole.name} rolünü düzenlemeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Rol eski haline getirildi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
  }
  await newRole.edit({
    name: oldRole.name,
    color: oldRole.color,
    hoist: oldRole.hoist,
    permissions: oldRole.permissions,
    mentionable: oldRole.mentionable,
    icon: oldRole.icon,
    unicodeEmoji: oldRole.unicodeEmoji 
    });
  } catch (error) {
    logger.error("Rol güncelleme olayı hatası:", error);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    let dangerPerms = [
      'ADMINISTRATOR',
      'KICK_MEMBERS',
      'MANAGE_GUILD',
      'BAN_MEMBERS',
      'MANAGE_ROLES',
      'MANAGE_WEBHOOKS',
      'MANAGE_NICKNAMES',
      'MANAGE_CHANNELS',
    ];
    if (oldMember.roles.cache.size === newMember.roles.cache.size || newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id) && dangerPerms.some((perm) => role.permissions.has(perm))).size === 0) return;

    const logs = await oldMember.guild.fetchAuditLogs({ 
      limit: 1, 
      type: AuditLogEvent.MemberRoleUpdate 
    });
    const entry = logs.entries.first();
    if ((!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "role") || await safeMembers(client, entry.executor.id, "owner"))) return;
    const member = await oldMember.guild.members.fetch(entry.executor.id).catch(() => null);
    if (member?.bannable) {
      await punish(client, member.id, "kick");
      sendLog("🛡️ Rol Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı ${newMember.user.tag} kullanıcısının rollerini değiştirmeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Roller eski haline getirildi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
  }
  await newMember.roles.set(oldMember.roles.cache);
  } catch (error) {
    logger.error("Üye rol güncelleme olayı hatası:", error);
  }
});

client.on("channelDelete", async (channel) => {
    try {
        const logs = await channel.guild.fetchAuditLogs({ 
            limit: 1, 
            type: AuditLogEvent.ChannelDelete 
        });
        const entry = logs.entries.first();
        
        if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "channel") || await safeMembers(client, entry.executor.id, "owner")) return;
        
        const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member?.bannable) {
            await punish(client, member.id, "kick");
            sendLog("🛡️ Kanal Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı ${channel.name} kanalını silmeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
        }
    } catch (error) {
        logger.error("Kanal silme olayı hatası:", error);
    }
});

client.on("channelCreate", async (channel) => {
    try {
        const logs = await channel.guild.fetchAuditLogs({ 
            limit: 1, 
            type: AuditLogEvent.ChannelCreate 
        });
        const entry = logs.entries.first();
        
        if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "channel") || await safeMembers(client, entry.executor.id, "owner")) return;
        
        const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member?.bannable) {
            await punish(client, member.id, "kick");
            await channel.delete({ reason: "[Astpod] İzinsiz kanal oluşturma" });
            sendLog("🛡️ Kanal Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı izinsiz kanal oluşturmaya çalıştı!\n- İşlem otomatik olarak engellendi\n- Oluşturulan kanal silindi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
        }
    } catch (error) {
        logger.error("Kanal oluşturma olayı hatası:", error);
    }
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
  try {
    const logs = await oldChannel.guild.fetchAuditLogs({ 
      limit: 1, 
      type: AuditLogEvent.ChannelUpdate 
    });
    const entry = logs.entries.first();
    if ((!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "channel") || await safeMembers(client, entry.executor.id, "owner"))) return;
    const member = await oldChannel.guild.members.fetch(entry.executor.id).catch(() => null);
    if (member?.bannable) {
      await punish(client, member.id, "kick");
      sendLog("🛡️ Kanal Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı ${oldChannel.name} kanalını düzenlemeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Kanal eski haline getirildi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
  }
   await newChannel.edit({
    name: oldChannel.name, 
    type: oldChannel.type, 
    position: oldChannel.rawPosition, 
    topic: oldChannel.topic, 
    nsfw: oldChannel.nsfw, 
    bitrate: oldChannel.bitrate, 
    userLimit: oldChannel.userLimit, 
    parent: oldChannel.parent, 
    lockPermissions: oldChannel.lockPermissions, 
    permissionOverwrites: oldChannel.Permissions, 
    rateLimitPerUser: oldChannel.rateLimitPerUser, 
    defaultAutoArchiveDuration: oldChannel.defaultAutoArchiveDuration, 
    rtcRegion: oldChannel.rtcRegion
    });
  } catch (error) {
    logger.error("Kanal güncelleme olayı hatası:", error);
  }
});

client.on("guildBanAdd", async (member) => {
    try {
        const logs = await member.guild.fetchAuditLogs({ 
            limit: 1, 
            type: AuditLogEvent.MemberBanAdd 
        });
        const entry = logs.entries.first();
        
        if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "banandkick") || await safeMembers(client, entry.executor.id, "owner")) return;
        
        const memberm = await member.guild.members.fetch(entry.executor.id).catch(() => null);
  if (memberm && memberm.bannable) {
            await punish(client, memberm.id, "kick");
            await member.guild.members.unban(member.user.id, "[Astpod] İzinsiz ban atma");
            sendLog("🛡️ Ban Koruma Sistemi", `\`\`\`- ${memberm.user.tag} adlı kullanıcı ${member.user.tag} kullanıcısını banlamaya çalıştı!\n- İşlem otomatik olarak engellendi\n- Ban kaldırıldı\n- Kullanıcı cezalandırıldı\`\`\``, "error");
        }
    } catch (error) {
        logger.error("Ban olayı hatası:", error);
    }
});

client.on("guildMemberRemove", async (member) => {
    try {
        const logs = await member.guild.fetchAuditLogs({ 
            limit: 1, 
            type: AuditLogEvent.MemberKick 
        });
        const entry = logs.entries.first();
        
        if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "banandkick") || await safeMembers(client, entry.executor.id, "owner")) return;
        
        const executor = await member.guild.members.fetch(entry.executor.id).catch(() => null);
        if (executor?.bannable) {
            await punish(client, executor.id, "kick");
            sendLog("🛡️ Kick Koruma Sistemi", `\`\`\`- ${executor.user.tag} adlı kullanıcı ${member.user.tag} kullanıcısını kicklemeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
        }
    } catch (error) {
        logger.error("Kick olayı hatası:", error);
    }
});

client.on("guildMemberAdd", async (member) => {
    try {
  if (!member.user.bot) return;
        
        const logs = await member.guild.fetchAuditLogs({ 
            limit: 1, 
            type: AuditLogEvent.BotAdd 
        });
        const entry = logs.entries.first();
        
        if (!entry || await safeMembers(client, entry.executor.id, "full")) return;
        
        const executor = await member.guild.members.fetch(entry.executor.id).catch(() => null);
        if (executor?.bannable) {
            await punish(client, executor.id, "kick");
            await member.kick({ reason: "[Astpod] İzinsiz bot ekleme" });
            sendLog("🛡️ Bot Koruma Sistemi", `\`\`\`- ${executor.user.tag} adlı kullanıcı izinsiz bot eklemeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Bot sunucudan atıldı\n- Kullanıcı cezalandırıldı\`\`\``, "error");
        }
    } catch (error) {
        logger.error("Bot ekleme olayı hatası:", error);
    }
});

client.on("webhookUpdate", async (channel) => {
  try {
      const logs = await channel.guild.fetchAuditLogs({ 
          limit: 1, 
          type: AuditLogEvent.WebhookUpdate 
      });
      const entry = logs.entries.first();
      
      if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
      
      const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
      if (member?.bannable) {
          await punish(client, member.id, "kick");
          sendLog("🛡️ Webhook Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı webhook'ları düzenlemeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
      }
  } catch (error) {
      logger.error("Webhook güncelleme olayı hatası:", error);
  }
});

client.on("emojiDelete", async (emoji) => {
  try {
      const logs = await emoji.guild.fetchAuditLogs({ 
          limit: 1, 
          type: AuditLogEvent.EmojiDelete 
      });
      const entry = logs.entries.first();
      
      if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
      
      const member = await emoji.guild.members.fetch(entry.executor.id).catch(() => null);
      if (member?.bannable) {
          await punish(client, member.id, "kick");
          sendLog("🛡️ Emoji Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı ${emoji.name} emojisini silmeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
      }
  } catch (error) {
      logger.error("Emoji silme olayı hatası:", error);
  }
});

client.on("emojiCreate", async (emoji) => {
  try {
      const logs = await emoji.guild.fetchAuditLogs({ 
          limit: 1, 
          type: AuditLogEvent.EmojiCreate 
      });
      const entry = logs.entries.first();
      
      if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
      
      const member = await emoji.guild.members.fetch(entry.executor.id).catch(() => null);
      if (member?.bannable) {
          await punish(client, member.id, "kick");
          await emoji.delete({ reason: "[Astpod] İzinsiz emoji oluşturma" });
          sendLog("🛡️ Emoji Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı izinsiz emoji oluşturmaya çalıştı!\n- İşlem otomatik olarak engellendi\n- Emoji silindi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
      }
  } catch (error) {
      logger.error("Emoji oluşturma olayı hatası:", error);
  }
});

let actionCounts = new Map();
const MAX_ACTIONS = 5;
const ACTION_RESET_TIME = 10000;

function checkActionLimit(userId, actionType) {
  const key = `${userId}-${actionType}`;
  const now = Date.now();
  
  if (!actionCounts.has(key)) {
      actionCounts.set(key, {
          count: 1,
          timestamp: now
      });
      return false;
  }
  
  const data = actionCounts.get(key);
  if (now - data.timestamp > ACTION_RESET_TIME) {
      actionCounts.set(key, {
          count: 1,
          timestamp: now
      });
      return false;
  }
  
  data.count++;
  if (data.count > MAX_ACTIONS) {
      return true;
  }
  
  return false;
}

client.on("stickerDelete", async (sticker) => {
  try {
      const logs = await sticker.guild.fetchAuditLogs({ 
          limit: 1, 
          type: AuditLogEvent.StickerDelete 
      });
      const entry = logs.entries.first();
      
      if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
      
      const member = await sticker.guild.members.fetch(entry.executor.id).catch(() => null);
      if (member?.bannable) {
          await punish(client, member.id, "kick");
          sendLog("🛡️ Sticker Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı ${sticker.name} çıkartmasını silmeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
      }
  } catch (error) {
      logger.error("Sticker silme olayı hatası:", error);
  }
});

client.on("stickerCreate", async (sticker) => {
  try {
      const logs = await sticker.guild.fetchAuditLogs({ 
          limit: 1, 
          type: AuditLogEvent.StickerCreate 
      });
      const entry = logs.entries.first();
      
      if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
      
      const member = await sticker.guild.members.fetch(entry.executor.id).catch(() => null);
      if (member?.bannable) {
          await punish(client, member.id, "kick");
          await sticker.delete({ reason: "[Astpod] İzinsiz çıkartma oluşturma" });
          sendLog("🛡️ Sticker Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı izinsiz çıkartma oluşturmaya çalıştı!\n- İşlem otomatik olarak engellendi\n- Çıkartma silindi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
      }
  } catch (error) {
      logger.error("Sticker oluşturma olayı hatası:", error);
  }
});

client.on("guildIntegrationsUpdate", async (guild) => {
  try {
      const logs = await guild.fetchAuditLogs({ 
          limit: 1, 
          type: AuditLogEvent.IntegrationUpdate 
      });
      const entry = logs.entries.first();
      
      if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
      
      const member = await guild.members.fetch(entry.executor.id).catch(() => null);
      if (member?.bannable) {
          await punish(client, member.id, "kick");
          sendLog("🛡️ Entegrasyon Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı sunucu entegrasyonlarını değiştirmeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
      }
  } catch (error) {
      logger.error("Entegrasyon güncelleme olayı hatası:", error);
  }
});

let banKickCounts = new Map();
const MAX_BAN_KICK = 3;
const BAN_KICK_RESET_TIME = 30000;

client.on("guildBanAdd", async (ban) => {
  try {
      const logs = await ban.guild.fetchAuditLogs({ 
          limit: 1, 
          type: AuditLogEvent.MemberBanAdd 
      });
      const entry = logs.entries.first();
      
      if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "banandkick") || await safeMembers(client, entry.executor.id, "owner")) return;
      
      const member = await ban.guild.members.fetch(entry.executor.id).catch(() => null);
      if (!member?.bannable) return;

      const key = `${member.id}-ban`;
      const now = Date.now();
      
      if (!banKickCounts.has(key)) {
          banKickCounts.set(key, {
              count: 1,
              timestamp: now
          });
  } else {
          const data = banKickCounts.get(key);
          if (now - data.timestamp > BAN_KICK_RESET_TIME) {
              banKickCounts.set(key, {
                  count: 1,
                  timestamp: now
              });
          } else {
              data.count++;
              if (data.count > MAX_BAN_KICK) {
                  await punish(client, member.id, "ban");
                  await ban.guild.members.unban(ban.user.id, "[Astpod] Toplu ban koruması");
                  sendLog("🛡️ Toplu Ban Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı ${MAX_BAN_KICK} saniye içinde ${data.count} kişiyi banlamaya çalıştı!\n- İşlem otomatik olarak engellendi\n- Kullanıcı banlandı\n- Banlanan üyeler geri alındı\`\`\``, "error");
                  return;
              }
          }
      }
      
      await punish(client, member.id, "kick");
      await ban.guild.members.unban(ban.user.id, "[Astpod] İzinsiz ban atma");
      sendLog("🛡️ Ban Koruma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı ${ban.user.tag} kullanıcısını banlamaya çalıştı!\n- İşlem otomatik olarak engellendi\n- Ban kaldırıldı\n- Kullanıcı cezalandırıldı\`\`\``, "error");
  } catch (error) {
      logger.error("Ban olayı hatası:", error);
  }
});

client.on("guildUpdate", async (oldGuild, newGuild) => {
  try {
      if (oldGuild.widgetEnabled !== newGuild.widgetEnabled || oldGuild.widgetChannelId !== newGuild.widgetChannelId) {
          const logs = await newGuild.fetchAuditLogs({ 
              limit: 1, 
              type: AuditLogEvent.GuildUpdate 
          });
          const entry = logs.entries.first();
          
          if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
          
          const executor = await oldGuild.members.fetch(entry.executor.id).catch(() => null);
          if (executor?.bannable) {
              await punish(client, executor.id, "kick");
              await newGuild.setWidgetSettings({
                  enabled: oldGuild.widgetEnabled,
                  channel: oldGuild.widgetChannelId
              });
              sendLog("🛡️ Widget Koruma Sistemi", `\`\`\`- ${executor.user.tag} adlı kullanıcı sunucu widget ayarlarını değiştirmeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Widget ayarları eski haline getirildi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
          }
      }
      
      if (oldGuild.discoverySplashURL() !== newGuild.discoverySplashURL()) {
          const logs = await newGuild.fetchAuditLogs({ 
              limit: 1, 
              type: AuditLogEvent.GuildUpdate 
          });
          const entry = logs.entries.first();
          
          if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
          
          const executor = await oldGuild.members.fetch(entry.executor.id).catch(() => null);
          if (executor?.bannable) {
              await punish(client, executor.id, "kick");
              await newGuild.setDiscoverySplash(oldGuild.discoverySplashURL());
              sendLog("🛡️ Afiş Koruma Sistemi", `\`\`\`- ${executor.user.tag} adlı kullanıcı sunucu afişini değiştirmeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Afiş eski haline getirildi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
          }
      }
      
      if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
          const logs = await newGuild.fetchAuditLogs({ 
              limit: 1, 
              type: AuditLogEvent.GuildUpdate 
          });
          const entry = logs.entries.first();
          
          if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
          
          const executor = await oldGuild.members.fetch(entry.executor.id).catch(() => null);
          if (executor?.bannable) {
              await punish(client, executor.id, "kick");
              await newGuild.setVerificationLevel(oldGuild.verificationLevel);
              sendLog("🛡️ Doğrulama Seviyesi Koruma Sistemi", `\`\`\`- ${executor.user.tag} adlı kullanıcı sunucu doğrulama seviyesini değiştirmeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Doğrulama seviyesi eski haline getirildi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
          }
      }
      
      if (oldGuild.description !== newGuild.description) {
          const logs = await newGuild.fetchAuditLogs({ 
              limit: 1, 
              type: AuditLogEvent.GuildUpdate 
          });
          const entry = logs.entries.first();
          
          if (!entry || await safeMembers(client, entry.executor.id, "full") || await safeMembers(client, entry.executor.id, "owner")) return;
          
          const executor = await oldGuild.members.fetch(entry.executor.id).catch(() => null);
          if (executor?.bannable) {
              await punish(client, executor.id, "kick");
              await newGuild.setDescription(oldGuild.description);
              sendLog("🛡️ Açıklama Koruma Sistemi", `\`\`\`- ${executor.user.tag} adlı kullanıcı sunucu açıklamasını değiştirmeye çalıştı!\n- İşlem otomatik olarak engellendi\n- Açıklama eski haline getirildi\n- Kullanıcı cezalandırıldı\`\`\``, "error");
          }
      }
  } catch (error) {
      logger.error("Sunucu güncelleme olayı hatası:", error);
  }
});

async function punish(client, userId, type) {
    try {
        const guild = client.guilds.cache.get(Config.GUILD_ID);
        const member = guild.members.cache.get(userId);
        
        if (!member) return;
        
        if (type === "ban") {
            await member.ban({ reason: "[Astpod] Güvenlik ihlali" });
            sendLog("⚡ Cezalandırma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı güvenlik ihlali nedeniyle banlandı!\n- Ban sebebi: Güvenlik ihlali\`\`\``, "error");
        } else if (type === "kick") {
            await member.kick({ reason: "[Astpod] Güvenlik ihlali" });
            sendLog("⚡ Cezalandırma Sistemi", `\`\`\`- ${member.user.tag} adlı kullanıcı güvenlik ihlali nedeniyle kicklendi!\n- Kick sebebi: Güvenlik ihlali\`\`\``, "error");
        }
    } catch (error) {
        logger.error("Cezalandırma fonksiyonu hatası:", error);
    }
}

async function safeMembers(client, userId, type) {
    try {
        const safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        
        if (!safeMember) {
            await SafeMember.create({
                guildID: Config.GUILD_ID,
                Full: [],
                Owner: [],
                Role: [],
                Channel: [],
                BanAndKick: []
            });
            return false;
        }
        
        if (Config.OWNER.includes(userId) || safeMember.Full.includes(userId)) {
        return true;
        }
        
        switch (type) {
            case "full":
                return safeMember.Full.includes(userId);
            case "owner":
                return safeMember.Owner.includes(userId);
            case "role":
                return safeMember.Role.includes(userId);
            case "channel":
                return safeMember.Channel.includes(userId);
            case "banandkick":
                return safeMember.BanAndKick.includes(userId);
            default:
                return false;
        }
    } catch (error) {
        logger.error("Güvenli üye kontrolü hatası:", error);
        return false;
  }
}

const ChannelTypes = {
    GUILD_TEXT: 0,
    DM: 1,
    GUILD_VOICE: 2,
    GROUP_DM: 3,
    GUILD_CATEGORY: 4,
    GUILD_NEWS: 5,
    GUILD_STORE: 6,
    UNKNOWN: 7,
    GUILD_NEWS_THREAD: 10,
    GUILD_PUBLIC_THREAD: 11,
    GUILD_PRIVATE_THREAD: 12,
    GUILD_STAGE_VOICE: 13,
}

async function getBackup() {
    try {
    const guild = client.guilds.cache.get(Config.GUILD_ID);
        if (!guild || !guild.roles.cache.size || !guild.channels.cache.size) {
            logger.error('[Astpod] Backup başarısız sunucu bulunamadı!');
            sendLog("🔄 Yedekleme Sistemi", `\`\`\`- Yedekleme işlemi başarısız oldu!\n- Sunucu veya gerekli önbellekler bulunamadı\`\`\``, "error");
            return false;
        }

    await RoleModel.deleteMany();
    guild.roles.cache.sort((a, b) => a.position - b.position).filter(role => !role.managed && role.id !== guild.id).forEach(async (role) => {
      const channelOverwrites = []

      guild.channels.cache.forEach(async (channel) => {
        if (channel.isThread() || !channel.permissionOverwrites.cache.has(role.id)) return;
        const permission = channel.permissionOverwrites.cache.get(role.id);
        channelOverwrites.push({
          id: channel.id,
          permissions: { ...permission.deny.serialize(), ...permission.allow.serialize() },
        });
    });
      await new RoleModel({
        id: role.id,
        channelOverwrites: channelOverwrites,
        members: role.members.map((member) => member.id),
        name: role.name,
        color: role.color,
        position: role.position,
        permissions: role.permissions.toArray(),
        mentionable: role.mentionable,
        hoist: role.hoist
      }).save()
    });
    await ChannelModel.deleteMany();
    guild.channels.cache.forEach(async (channel) => {
      if (channel.isThread()) return;

      await new ChannelModel({
        id: channel.id,
                type: ChannelTypes[channel.type] ?? 0,
        parent: channel.parentId,
        name: channel.name,
                topic: channel.isTextBased() ? channel.topic : undefined,
        position: channel.position,
        permissionOverwrites: channel.permissionOverwrites.cache.map((permission) => {
          return {
            id: permission.id,
            type: permission.type,
            allow: permission.allow.toArray(),
            deny: permission.deny.toArray(),
          };
        }),
                nsfw: channel.isTextBased() ? channel.nsfw : undefined,
                userLimit: channel.type === ChannelType.GuildVoice ? channel.userLimit : undefined,
      }).save()
    });
    console.log("[Astpod] Başarılı şekilde kanallar ve roller yedeklendi !")
        sendLog("🔄 Yedekleme Sistemi", `\`\`\`+ Yedekleme işlemi başarıyla tamamlandı!\n+ Tüm roller ve kanallar yedeklendi\`\`\``, "success");
    return true;
    } catch (error) {
        logger.error(`Backup hatası: ${error.message}`);
        sendLog("🔄 Yedekleme Sistemi", `\`\`\`- Yedekleme işlemi sırasında hata oluştu!\n- Hata: ${error.message}\`\`\``, "error");
        return false;
    }
}

async function startHelpers() {
    try {
        console.log('[Astpod] Dağıtıcılar Açılıyor...');

        const promises = [];
        for (const TOKEN of Config.TOKENS) {
            promises.push(new Promise((resolve) => {
                const helperClient = new Client({
                    intents: [
                        GatewayIntentBits.Guilds,
                        GatewayIntentBits.GuildMembers,
                        GatewayIntentBits.GuildPresences
                    ],
                    presence: {
                        activities: [{ name: Config.STATUS, type: 'PLAYING' }],
                    },
                });

                helperClient.on('ready', async () => {
                    const guild = helperClient.guilds.cache.get(Config.GUILD_ID);
                    if (!guild) {
                        console.log(`[Astpod] HATA: ${helperClient.user.tag} adlı Dağıtıcı Sunucuda Bulunmuyor.`);
                        helperClient.destroy();
                        return;
                    }

                    try {
                        const roles = await RoleModel.find();
                        if (roles && roles.length > 0) {
                            console.log(`[Astpod] ${helperClient.user.tag} rol dağıtımına başlıyor...`);
                            
                            for (const roleData of roles) {
                                const role = guild.roles.cache.get(roleData.id);
                                if (!role) continue;

                                if (roleData.members && roleData.members.length > 0) {
                                    for (const memberId of roleData.members) {
                                        try {
                                            const member = await guild.members.fetch(memberId).catch(() => null);
                                            if (member && !member.roles.cache.has(role.id)) {
                                                await member.roles.add(role);
                                                console.log(`[Astpod] ${helperClient.user.tag} - ${member.user.tag} kullanıcısına ${role.name} rolü verildi.`);
                                            }
                                        } catch (error) {
                                            console.error(`[Astpod] Rol atama hatası (${memberId}):`, error);
                                        }
                                    }
                                }
                            }
                            console.log(`[Astpod] ${helperClient.user.tag} rol dağıtımını tamamladı!`);
                        }
                    } catch (error) {
                        console.error(`[Astpod] ${helperClient.user.tag} rol dağıtım hatası:`, error);
                    }

                    resolve(helperClient);
                });

                helperClient.on('rateLimit', (rateLimitData) => {
                    console.log(`[Astpod] HATA: ${helperClient.user.tag} adlı dağıtıcı rate limit yedi yeme saniyesi: ${Math.round(rateLimitData.timeout / 1000)} saniye.`);
                });

                helperClient.login(TOKEN);
            }));
        }

        const results = await Promise.all(promises);
        logger.info('Yardımcılar Açıldı!');
        return results;
    } catch (error) {
        logger.error(`Yardımcılar Açılırken Hata Oluştu: ${error.message}`);
        return [];
    }
}

client.on('error', error => {
    logger.error('Discord client error:', error);
    sendLog("Bot Hatası", "Bot bir hatayla karşılaştı!", "error");
});

client.on('warn', warning => {
    logger.warn('Discord client warning:', warning);
    sendLog("Bot Uyarısı", "Bot bir uyarı aldı!", "warning");
});

client.on('rateLimit', rateLimitInfo => {
    logger.warn('Rate limit hit:', rateLimitInfo);
    sendLog("Rate Limit", "Bot rate limit'e takıldı!", "warning");
});

if (!Config.TOKENS || Config.TOKENS.length === 0) {
    logger.error("Token bulunamadı! Lütfen config.json dosyasını kontrol edin.");
    process.exit(1);
}

client.login(Config.TOKENS[0]).then(() => {
    logger.info("[Astpod] Bot başarıyla giriş yaptı!");
    sendLog("Bot Girişi", "Bot başarıyla giriş yaptı!", "success");
}).catch(error => {
    logger.error("[Astpod] Bot giriş hatası:", error);
    sendLog("Bot Giriş Hatası", "Bot giriş yapamadı!", "error");
    process.exit(1);
});

if (Config.TOKENS.length > 1) {
    Config.TOKENS.splice(0, 1);
}

async function checkFull(question, row, target) {
    try {
        let safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        if (!safeMember) {
            safeMember = await SafeMember.create({
                guildID: Config.GUILD_ID,
                Full: [],
                Owner: [],
                Role: [],
                Channel: [],
                BanAndKick: []
            });
        }

        if (safeMember.Full.includes(target.id)) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription(`${target} zaten Full güvenli listesinde!`)
                ],
                components: []
            });
            return;
        }

        safeMember.Full.push(target.id);
        await safeMember.save();

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`${target} başarıyla Full güvenli listesine eklendi!`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Full güvenli ekleme hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("İşlem sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function checkOwner(question, row, target) {
    try {
        let safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        if (!safeMember) {
            safeMember = await SafeMember.create({
                guildID: Config.GUILD_ID,
                Full: [],
                Owner: [],
                Role: [],
                Channel: [],
                BanAndKick: []
            });
        }

        if (safeMember.Owner.includes(target.id)) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription(`${target} zaten Owner güvenli listesinde!`)
                ],
                components: []
            });
            return;
        }

        safeMember.Owner.push(target.id);
        await safeMember.save();

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`${target} başarıyla Owner güvenli listesine eklendi!`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Owner güvenli ekleme hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("İşlem sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function checkRol(question, row, target) {
    try {
        let safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        if (!safeMember) {
            safeMember = await SafeMember.create({
                guildID: Config.GUILD_ID,
                Full: [],
                Owner: [],
                Role: [],
                Channel: [],
                BanAndKick: []
            });
        }

        if (safeMember.Role.includes(target.id)) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription(`${target} zaten Rol güvenli listesinde!`)
                ],
                components: []
            });
            return;
        }

        safeMember.Role.push(target.id);
        await safeMember.save();

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`${target} başarıyla Rol güvenli listesine eklendi!`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Rol güvenli ekleme hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("İşlem sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function checkChannel(question, row, target) {
    try {
        let safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        if (!safeMember) {
            safeMember = await SafeMember.create({
                guildID: Config.GUILD_ID,
                Full: [],
                Owner: [],
                Role: [],
                Channel: [],
                BanAndKick: []
            });
        }

        if (safeMember.Channel.includes(target.id)) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription(`${target} zaten Kanal güvenli listesinde!`)
                ],
                components: []
            });
            return;
        }

        safeMember.Channel.push(target.id);
        await safeMember.save();

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`${target} başarıyla Kanal güvenli listesine eklendi!`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Kanal güvenli ekleme hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("İşlem sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function checkBanKick(question, row, target) {
    try {
        let safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        if (!safeMember) {
            safeMember = await SafeMember.create({
                guildID: Config.GUILD_ID,
                Full: [],
                Owner: [],
                Role: [],
                Channel: [],
                BanAndKick: []
            });
        }

        if (safeMember.BanAndKick.includes(target.id)) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription(`${target} zaten Ban ve Kick güvenli listesinde!`)
                ],
                components: []
            });
            return;
        }

        safeMember.BanAndKick.push(target.id);
        await safeMember.save();

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`${target} başarıyla Ban ve Kick güvenli listesine eklendi!`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Ban ve Kick güvenli ekleme hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("İşlem sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function checkRoles(question, row) {
    try {
        const guild = client.guilds.cache.get(Config.GUILD_ID);
        if (!guild) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Sunucu bulunamadı!")
                ],
                components: []
            });
            return;
        }

        const roles = await RoleModel.find();
        if (!roles || roles.length === 0) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Yedeklenecek rol bulunamadı!")
                ],
                components: []
            });
            return;
        }

        let createdRoles = 0;
        let failedRoles = 0;
        let roleAssignments = 0;
        let failedAssignments = 0;

        const helpers = await startHelpers();
        if (helpers.length === 0) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Dağıtıcı botlar başlatılamadı!")
                ],
                components: []
            });
            return;
        }

        for (const roleData of roles) {
            try {
                if (guild.roles.cache.has(roleData.id)) continue;

                const newRole = await guild.roles.create({
                    name: roleData.name,
                    color: roleData.color,
                    hoist: roleData.hoist,
                    position: roleData.position,
                    permissions: roleData.permissions,
                    mentionable: roleData.mentionable
                });

                if (roleData.channelOverwrites && roleData.channelOverwrites.length > 0) {
                    for (const overwrite of roleData.channelOverwrites) {
                        const channel = guild.channels.cache.get(overwrite.id);
                        if (channel) {
                            await channel.permissionOverwrites.create(newRole, overwrite.permissions);
                        }
                    }
                }

                if (roleData.members && roleData.members.length > 0) {
                    const chunkSize = Math.ceil(roleData.members.length / helpers.length);
                    const memberChunks = [];
                    
                    for (let i = 0; i < roleData.members.length; i += chunkSize) {
                        memberChunks.push(roleData.members.slice(i, i + chunkSize));
                    }

                    for (let i = 0; i < helpers.length; i++) {
                        const helper = helpers[i];
                        const members = memberChunks[i] || [];
                        
                        for (const memberId of members) {
                            try {
                                const member = await guild.members.fetch(memberId).catch(() => null);
                                if (member) {
                                    await member.roles.add(newRole);
                                    roleAssignments++;
                                }
                            } catch (error) {
                                console.error(`Rol atama hatası (${memberId}):`, error);
                                failedAssignments++;
                            }
                        }
                    }
                }

                createdRoles++;
            } catch (error) {
                console.error(`Rol oluşturma hatası (${roleData.name}):`, error);
                failedRoles++;
            }
        }

        for (const helper of helpers) {
            helper.destroy();
        }

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`Rol kurma işlemi tamamlandı!\n\n✅ Başarıyla oluşturulan roller: ${createdRoles}\n❌ Başarısız olan roller: ${failedRoles}\n\n👥 Başarıyla rol atanan üyeler: ${roleAssignments}\n❌ Rol atanamayan üyeler: ${failedAssignments}`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Rol kurma hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("Rol kurma işlemi sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function checkChannels(question, row) {
    try {
        const guild = client.guilds.cache.get(Config.GUILD_ID);
        if (!guild) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Sunucu bulunamadı!")
                ],
                components: []
            });
            return;
        }

        const channels = await ChannelModel.find();
        if (!channels || channels.length === 0) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Yedeklenecek kanal bulunamadı!")
                ],
                components: []
            });
            return;
        }

        let createdChannels = 0;
        let failedChannels = 0;

        for (const channelData of channels) {
            try {
                if (guild.channels.cache.has(channelData.id)) continue;

                const channelOptions = {
                    type: channelData.type,
                    topic: channelData.topic,
                    nsfw: channelData.nsfw,
                    bitrate: channelData.bitrate,
                    userLimit: channelData.userLimit,
                    rateLimitPerUser: channelData.rateLimitPerUser,
                    position: channelData.position,
                    parent: channelData.parent
                };

                const newChannel = await guild.channels.create({
                    name: channelData.name,
                    ...channelOptions
                });

                if (channelData.permissionOverwrites && channelData.permissionOverwrites.length > 0) {
                    for (const overwrite of channelData.permissionOverwrites) {
                        await newChannel.permissionOverwrites.create(overwrite.id, {
                            allow: overwrite.allow,
                            deny: overwrite.deny
                        });
                    }
                }

                createdChannels++;
            } catch (error) {
                console.error(`Kanal oluşturma hatası (${channelData.name}):`, error);
                failedChannels++;
            }
        }

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`Kanal kurma işlemi tamamlandı!\n\n✅ Başarıyla oluşturulan: ${createdChannels}\n❌ Başarısız olan: ${failedChannels}`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Kanal kurma hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("Kanal kurma işlemi sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function removeFull(question, row, target) {
    try {
        let safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        if (!safeMember) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Güvenli üye listesi bulunamadı!")
                ],
                components: []
            });
            return;
        }

        if (!safeMember.Full.includes(target.id)) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription(`${target} zaten Full güvenli listesinde değil!`)
                ],
                components: []
            });
            return;
        }

        safeMember.Full = safeMember.Full.filter(id => id !== target.id);
        await safeMember.save();

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`${target} başarıyla Full güvenli listesinden çıkarıldı!`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Full güvenli çıkarma hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("İşlem sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function removeOwner(question, row, target) {
    try {
        let safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        if (!safeMember) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Güvenli üye listesi bulunamadı!")
                ],
                components: []
            });
            return;
        }

        if (!safeMember.Owner.includes(target.id)) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription(`${target} zaten Owner güvenli listesinde değil!`)
                ],
                components: []
            });
            return;
        }

        safeMember.Owner = safeMember.Owner.filter(id => id !== target.id);
        await safeMember.save();

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`${target} başarıyla Owner güvenli listesinden çıkarıldı!`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Owner güvenli çıkarma hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("İşlem sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function removeRol(question, row, target) {
    try {
        let safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        if (!safeMember) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Güvenli üye listesi bulunamadı!")
                ],
                components: []
            });
            return;
        }

        if (!safeMember.Role.includes(target.id)) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription(`${target} zaten Rol güvenli listesinde değil!`)
                ],
                components: []
            });
            return;
        }

        safeMember.Role = safeMember.Role.filter(id => id !== target.id);
        await safeMember.save();

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`${target} başarıyla Rol güvenli listesinden çıkarıldı!`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Rol güvenli çıkarma hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("İşlem sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function removeChannel(question, row, target) {
    try {
        let safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        if (!safeMember) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Güvenli üye listesi bulunamadı!")
                ],
                components: []
            });
            return;
        }

        if (!safeMember.Channel.includes(target.id)) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription(`${target} zaten Kanal güvenli listesinde değil!`)
                ],
                components: []
            });
            return;
        }

        safeMember.Channel = safeMember.Channel.filter(id => id !== target.id);
        await safeMember.save();

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`${target} başarıyla Kanal güvenli listesinden çıkarıldı!`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Kanal güvenli çıkarma hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("İşlem sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}

async function removeBanKick(question, row, target) {
    try {
        let safeMember = await SafeMember.findOne({ guildID: Config.GUILD_ID });
        if (!safeMember) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription("Güvenli üye listesi bulunamadı!")
                ],
                components: []
            });
            return;
        }

        if (!safeMember.BanAndKick.includes(target.id)) {
            await question.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("Red")
                        .setDescription(`${target} zaten Ban ve Kick güvenli listesinde değil!`)
                ],
                components: []
            });
            return;
        }

        safeMember.BanAndKick = safeMember.BanAndKick.filter(id => id !== target.id);
        await safeMember.save();

        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Green")
                    .setDescription(`${target} başarıyla Ban ve Kick güvenli listesinden çıkarıldı!`)
            ],
            components: []
        });
    } catch (error) {
        console.error("Ban ve Kick güvenli çıkarma hatası:", error);
        await question.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor("Red")
                    .setDescription("İşlem sırasında bir hata oluştu!")
            ],
            components: []
        });
    }
}