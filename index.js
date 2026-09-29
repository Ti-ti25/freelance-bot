require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    AttachmentBuilder,
    StringSelectMenuBuilder 
} = require('discord.js');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ] 
});

const commands = [
    new SlashCommandBuilder()
        .setName('setup-boutique')
        .setDescription('Envoie le panneau de commande pour les clients'),
    new SlashCommandBuilder()
        .setName('proposer')
        .setDescription('Proposer un devis (prix et délai) pour ce ticket (Réservé aux Freelancers)')
        .addStringOption(option => 
            option.setName('prix')
                .setDescription('Le montant (ex: 50€)')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('delai')
                .setDescription('Le délai estimé (ex: 3 jours)')
                .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const pendingOrders = new Map();

client.once('ready', async () => {
    console.log(`Connecté en tant que ${client.user.tag} !`);
    try {
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );
        console.log('Commandes slash enregistrées avec succès !');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup-boutique') {
            const embed = new EmbedBuilder()
                .setTitle('🛠️ Services & Commandes - K25 Freelance')
                .setDescription('Tu veux commander une prestation ? Clique sur le bouton ci-dessous pour ouvrir ton espace de discussion.')
                .setColor(0x5865F2)
                .setFooter({ text: 'Système de devis sur mesure' });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('open_order_select')
                        .setLabel('Commander une prestation')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🛒')
                );

            await interaction.reply({ content: 'Panneau généré avec succès !', ephemeral: true });
            await interaction.channel.send({ embeds: [embed], components: [row] });
        }

        else if (interaction.commandName === 'proposer') {
            if (!interaction.channel.name.startsWith('cmd-')) {
                return interaction.reply({ content: '❌ Cette commande ne peut être utilisée que dans un salon de ticket.', ephemeral: true });
            }

            const hasFreelancerRole = interaction.member.roles.cache.some(r => r.name.toLowerCase() === 'freelancer');
            if (!hasFreelancerRole) {
                return interaction.reply({ 
                    content: '❌ Action interdite : Seuls les membres possédant le rôle **Freelancer** peuvent proposer un devis.', 
                    ephemeral: true 
                });
            }

            const prix = interaction.options.getString('prix');
            const delai = interaction.options.getString('delai');

            // Retrouver le client à partir du nom du salon (cmd-nomduclient)
            const memberTag = interaction.channel.name.replace('cmd-', '');
            const targetMember = interaction.guild.members.cache.find(m => m.user.username.toLowerCase() === memberTag.toLowerCase());
            const clientPing = targetMember ? `<@${targetMember.id}>` : 'le client';

            const proposalEmbed = new EmbedBuilder()
                .setTitle('💡 Proposition de Devis')
                .setDescription(`Une proposition vient d'être faite par le freelance ${interaction.user} :\n\n💰 **Prix :** ${prix}\n⏳ **Délai :** ${delai}`)
                .setColor(0xFEE75C)
                .setTimestamp();

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`accept_devis_${prix}_${delai}`)
                    .setLabel('Valider le devis')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId('cancel_devis')
                    .setLabel('Refuser / Annuler')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

            // On envoie la réponse publique avec le ping du client
            await interaction.reply({ 
                content: `🔔 ${clientPing}, une nouvelle proposition de devis vous a été envoyée !`, 
                embeds: [proposalEmbed], 
                components: [actionRow] 
            });
        }
    } 
    
    else if (interaction.isButton()) {
        const isFreelancer = interaction.member.roles.cache.some(r => r.name.toLowerCase() === 'freelancer');
        const freelancerRoleObj = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'freelancer');

        if (interaction.customId === 'open_order_select') {
            const selectRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_service_type')
                    .setPlaceholder('Choisis la catégorie de ton projet...')
                    .addOptions([
                        { label: 'Site Web / Portfolio', description: 'Création de site sur mesure', value: 'Site Web / Portfolio' },
                        { label: 'Bot Discord sur mesure', description: 'Développement de bot personnalisé', value: 'Bot Discord' },
                        { label: 'Map UEFN / Fortnite', description: 'Conception de map et mécaniques', value: 'Map UEFN' },
                        { label: 'Autre projet personnalisé', description: 'Discutons-en dans le ticket', value: 'Projet personnalisé' }
                    ])
            );

            await interaction.reply({ 
                content: '📌 Sélectionne le type de prestation :', 
                components: [selectRow], 
                ephemeral: true 
            });
        }

        // Validation du devis
        else if (interaction.customId.startsWith('accept_devis_')) {
            const parts = interaction.customId.split('_');
            const prix = parts[2];
            const delai = parts[3];

            const messages = await interaction.channel.messages.fetch({ limit: 10 });
            const mainMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title?.includes('Commande de'));

            if (mainMessage) {
                const embed = EmbedBuilder.from(mainMessage.embeds[0]);
                const fields = embed.data.fields.map(f => {
                    if (f.name === 'Prix & Délai validés') {
                        f.value = `💰 ${prix} | ⏳ ${delai}`;
                    }
                    if (f.name === 'Statut du projet') {
                        f.value = '💻 Code en création';
                    }
                    return f;
                });
                embed.setFields(fields);
                embed.setColor(0x57F287);

                await mainMessage.edit({ embeds: [embed] });
            }

            await interaction.update({ 
                content: `✅ **Devis validé !** Montant : ${prix} | Délai : ${delai}. Le projet passe en création.`, 
                embeds: [], 
                components: [] 
            });
        }

        // Annulation / Refus du devis proposé
        else if (interaction.customId === 'cancel_devis') {
            await interaction.update({ 
                content: `❌ **Proposition de devis refusée/annulée.** Le freelance peut en proposer une nouvelle avec \`/proposer\`.`, 
                embeds: [], 
                components: [] 
            });
        }

        // Statuts détaillés (Sécurisé : Réservé aux Freelancers)
        else if (interaction.customId.startsWith('status_')) {
            if (!isFreelancer) {
                return interaction.reply({ 
                    content: '❌ Seul un **Freelancer** peut modifier l\'avancement du projet.', 
                    ephemeral: true 
                });
            }

            const newStatus = interaction.customId.split('_')[1];
            let statusText = '';

            if (newStatus === 'creation') { statusText = '💻 Code en création'; }
            else if (newStatus === 'test') { statusText = '🧪 En cours de test'; }
            else if (newStatus === 'livraison') { statusText = '🚀 Prêt / En cours de livraison'; }
            else if (newStatus === 'termine') { statusText = '🟢 Terminé & Livré'; }

            const messages = await interaction.channel.messages.fetch({ limit: 10 });
            const mainMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title?.includes('Commande de'));

            if (mainMessage) {
                const embed = EmbedBuilder.from(mainMessage.embeds[0]);
                const fields = embed.data.fields.map(f => {
                    if (f.name === 'Statut du projet') f.value = statusText;
                    return f;
                });
                embed.setFields(fields);
                await mainMessage.edit({ embeds: [embed] });
            }

            await interaction.update({ embeds: interaction.message.embeds });
            await interaction.channel.send(`🔔 **Mise à jour du statut :** ${statusText}`);
        }
        
        // Demande de fermeture de ticket -> Ping du rôle Freelancer
        else if (interaction.customId === 'close_ticket') {
            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('confirm_close').setLabel('Confirmer la fermeture').setStyle(ButtonStyle.Danger).setEmoji('✅'),
                new ButtonBuilder().setCustomId('cancel_close').setLabel('Annuler').setStyle(ButtonStyle.Secondary).setEmoji('❌')
            );

            const pingText = freelancerRoleObj ? `<@&${freelancerRoleObj.id}>` : '**[Freelancer]**';

            await interaction.reply({ 
                content: `⚠️ ${pingText}, une demande de fermeture/annulation de ticket a été demandée par ${interaction.user}. Confirmez-vous la fermeture définitive ?`, 
                components: [confirmRow] 
            });
        }

        // Confirmation finale de fermeture (Sécurisé : Réservé aux Freelancers)
        else if (interaction.customId === 'confirm_close') {
            if (!isFreelancer) {
                return interaction.reply({ 
                    content: '❌ Seul un **Freelancer** peut valider la fermeture définitive et l\'archivage du ticket.', 
                    ephemeral: true 
                });
            }

            await interaction.update({ content: '🔒 Fermeture du ticket en cours, génération du transcript...', components: [] });

            try {
                const messages = await interaction.channel.messages.fetch({ limit: 100 });
                const transcript = messages.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
                
                const buffer = Buffer.from(transcript, 'utf-8');
                const attachment = new AttachmentBuilder(buffer, { name: `transcript-${interaction.channel.name}.txt` });

                let archiveChannel = interaction.guild.channels.cache.find(c => c.name === 'archives-tickets');
                if (!archiveChannel) {
                    archiveChannel = await interaction.guild.channels.create({
                        name: 'archives-tickets',
                        type: ChannelType.GuildText,
                    });
                }

                await archiveChannel.send({ 
                    content: `📁 Archive du ticket **${interaction.channel.name}** fermé par ${interaction.user}`, 
                    files: [attachment] 
                });

                const memberTag = interaction.channel.name.replace('cmd-', '');
                const targetMember = interaction.guild.members.cache.find(m => m.user.username.toLowerCase() === memberTag.toLowerCase());
                const ongoingRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'projet en cours');
                
                if (targetMember && ongoingRole) {
                    await targetMember.roles.remove(ongoingRole).catch(() => {});
                }

                setTimeout(async () => {
                    await interaction.channel.delete();
                }, 3000);

            } catch (err) {
                console.error('Erreur lors de la fermeture :', err);
            }
        }

        // Annuler la demande de fermeture
        else if (interaction.customId === 'cancel_close') {
            await interaction.update({ content: '✅ Fermeture annulée. Le ticket reste ouvert.', components: [] });
        }
    }

    else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_service_type') {
            const selectedService = interaction.values[0];
            pendingOrders.set(interaction.user.id, selectedService);

            const modal = new ModalBuilder()
                .setCustomId('order_modal')
                .setTitle('Détails de votre projet');

            const descInput = new TextInputBuilder()
                .setCustomId('service_desc')
                .setLabel('Explique ton projet en détail')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(descInput));
            await interaction.showModal(modal);
        }
    }

    else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'order_modal') {
            await interaction.deferReply({ ephemeral: true });

            const serviceType = pendingOrders.get(interaction.user.id) || 'Service personnalisé';
            const serviceDesc = interaction.fields.getTextInputValue('service_desc');
            pendingOrders.delete(interaction.user.id);

            try {
                const channel = await interaction.guild.channels.create({
                    name: `cmd-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: ['ViewChannel'] },
                        { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                        { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'] },
                    ],
                });

                const ongoingRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'projet en cours');
                if (ongoingRole) {
                    await interaction.member.roles.add(ongoingRole).catch(() => {});
                }

                const ticketEmbed = new EmbedBuilder()
                    .setTitle(`📋 Commande de ${interaction.user.tag}`)
                    .addFields(
                        { name: 'Prestation choisie', value: serviceType, inline: true },
                        { name: 'Prix & Délai validés', value: '⏳ En attente de devis', inline: true },
                        { name: 'Statut du projet', value: '⏳ En attente de devis du freelance', inline: false },
                        { name: 'Description du projet', value: serviceDesc, inline: false }
                    )
                    .setColor(0xFEE75C)
                    .setTimestamp();

                const statusRow1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('status_creation').setLabel('Code en création').setStyle(ButtonStyle.Secondary).setEmoji('💻'),
                    new ButtonBuilder().setCustomId('status_test').setLabel('En test').setStyle(ButtonStyle.Primary).setEmoji('🧪')
                );
                
                const statusRow2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('status_livraison').setLabel('Prêt / Livraison').setStyle(ButtonStyle.Success).setEmoji('🚀'),
                    new ButtonBuilder().setCustomId('status_termine').setLabel('Terminé').setStyle(ButtonStyle.Success).setEmoji('🟢')
                );

                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Fermer / Annuler').setStyle(ButtonStyle.Danger).setEmoji('🔒')
                );

                const freelancerRoleObj = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'freelancer');
                const pingText = freelancerRoleObj ? `<@&${freelancerRoleObj.id}>` : '@Freelancer';

                // Ping automatique du rôle Freelancer dans le message d'ouverture
                await channel.send({ 
                    content: `🔔 ${pingText} - Nouvelle commande de ${interaction.user} !\nLe salon est ouvert. En attente de la proposition de devis via \`/proposer\`.`, 
                    embeds: [ticketEmbed], 
                    components: [statusRow1, statusRow2, closeRow] 
                });

                await interaction.editReply({ 
                    content: `✅ Ton espace de commande a été créé avec succès : ${channel}` 
                });
            } catch (error) {
                console.error(error);
                await interaction.editReply({ 
                    content: '❌ Une erreur est survenue lors de la création du salon.' 
                });
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);