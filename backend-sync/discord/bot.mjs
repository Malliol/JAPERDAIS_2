#!/usr/bin/env node
// Discord-бот JAPERDAIS: разворачивает и админит структуру сервера.
// /setup — создаёт категории/каналы/роли (не трогает то, что уже есть
// с таким же названием — безопасно перезапускать). Токен — в .env рядом
// (см. env.example). Права бота настраиваются при приглашении на сервер.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ChannelType, PermissionsBitField
} from 'discord.js'

const HERE = dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envPath = join(HERE, '.env')
  if (!existsSync(envPath)) return {}
  const out = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const env = loadEnv()
const TOKEN = process.env.DISCORD_TOKEN || env.DISCORD_TOKEN
const GUILD_ID = process.env.GUILD_ID || env.GUILD_ID
if (!TOKEN) { console.error('DISCORD_TOKEN не задан в sync/discord/.env'); process.exit(1) }
if (!GUILD_ID) { console.error('GUILD_ID не задан в sync/discord/.env'); process.exit(1) }

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`) }

// --- предлагаемая структура сервера JAPERDAIS ---
// каждая запись создаётся, только если категории/канала/роли с таким
// именем ещё нет — повторный /setup ничего не дублирует и не удаляет
const STRUCTURE = {
  roles: [
    { name: 'Разработчик', color: 0xe0a030 },
    { name: 'Художник', color: 0x9b59d6 },
    { name: 'Тестировщик', color: 0x4caf6b },
    { name: 'Подписчик', color: 0x8a8a8a }
  ],
  categories: [
    {
      name: '📋 ИНФОРМАЦИЯ',
      channels: [
        { name: 'добро-пожаловать', type: 'text' },
        { name: 'объявления', type: 'text' }
      ]
    },
    {
      name: '💬 ОБЩЕНИЕ',
      channels: [
        { name: 'общий-чат', type: 'text' },
        { name: 'арт-и-референсы', type: 'text' },
        { name: 'идеи-и-фидбек', type: 'text' }
      ]
    },
    {
      name: '🛠 РАЗРАБОТКА',
      channels: [
        { name: 'баги', type: 'text' },
        { name: 'роадмап', type: 'text' },
        { name: 'деплои', type: 'text' }
      ]
    },
    {
      name: '🔊 ГОЛОСОВЫЕ',
      channels: [
        { name: 'Общий', type: 'voice' },
        { name: 'Разработка', type: 'voice' },
        { name: 'Геймдев', type: 'voice' },
        { name: 'Стрим', type: 'voice' },
        { name: 'Чилл', type: 'voice' },
        { name: 'AFK', type: 'voice' }
      ]
    }
  ],
  // канал, куда попадают системные сообщения о новых участниках и который
  // Discord показывает первым при заходе на сервер
  landingChannel: 'добро-пожаловать'
}

async function runSetup(guild) {
  const report = []

  await guild.channels.fetch()
  const oldRules = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === 'правила')
  if (oldRules) {
    await oldRules.delete('JAPERDAIS bot /setup: канал «правила» больше не нужен')
    report.push('удалён канал «правила»')
  }

  for (const r of STRUCTURE.roles) {
    const existing = guild.roles.cache.find(x => x.name === r.name)
    if (existing) { report.push(`роль «${r.name}» уже есть`); continue }
    await guild.roles.create({ name: r.name, color: r.color, mentionable: true, reason: 'JAPERDAIS bot /setup' })
    report.push(`создана роль «${r.name}»`)
  }

  await guild.channels.fetch() // на всякий случай освежить кэш категорий/каналов
  for (const cat of STRUCTURE.categories) {
    let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === cat.name)
    if (!category) {
      category = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, reason: 'JAPERDAIS bot /setup' })
      report.push(`создана категория «${cat.name}»`)
    } else {
      report.push(`категория «${cat.name}» уже есть`)
    }
    for (const ch of cat.channels) {
      const exists = guild.channels.cache.find(c => c.parentId === category.id && c.name === ch.name)
      if (exists) { report.push(`  канал «${ch.name}» уже есть`); continue }
      await guild.channels.create({
        name: ch.name,
        type: ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
        parent: category.id,
        reason: 'JAPERDAIS bot /setup'
      })
      report.push(`  создан канал «${ch.name}»`)
    }
  }

  if (STRUCTURE.landingChannel) {
    const landing = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === STRUCTURE.landingChannel)
    if (landing) {
      if (guild.systemChannelId !== landing.id) {
        await guild.setSystemChannel(landing, 'JAPERDAIS bot /setup: канал для новых участников')
        report.push(`канал «${STRUCTURE.landingChannel}» назначен для новых участников`)
      }
      if (landing.rawPosition !== 0) {
        await landing.setPosition(0)
        report.push(`канал «${STRUCTURE.landingChannel}» поднят наверх списка`)
      }
    }
  }

  return report
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('Развернуть структуру каналов и ролей JAPERDAIS (безопасно перезапускать)'),
  new SlashCommandBuilder().setName('ping').setDescription('Проверка, что бот на связи')
].map(c => c.toJSON())

client.once('ready', async () => {
  log(`бот в сети как ${client.user.tag}`)
  const rest = new REST({ version: '10' }).setToken(TOKEN)
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands })
    log('слэш-команды зарегистрированы')
  } catch (e) {
    log('ОШИБКА регистрации команд: ' + e.message)
  }
})

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName === 'ping') {
    await interaction.reply({ content: 'на связи', ephemeral: true })
    return
  }
  if (interaction.commandName === 'setup') {
    const member = interaction.member
    if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      await interaction.reply({ content: 'нужны права «Управление сервером»', ephemeral: true })
      return
    }
    await interaction.deferReply({ ephemeral: true })
    try {
      const report = await runSetup(interaction.guild)
      log('setup выполнен: ' + report.join('; '))
      const text = report.length ? report.join('\n') : 'нечего создавать'
      await interaction.editReply({ content: 'Готово:\n' + text.slice(0, 1900) })
    } catch (e) {
      log('ОШИБКА setup: ' + e.message)
      await interaction.editReply({ content: 'Ошибка: ' + e.message })
    }
  }
})

client.login(TOKEN)
