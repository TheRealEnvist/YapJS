'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Collection = require('../util/Collection');
const { Events } = require('../util/constants');
const { YapperError } = require('../util/errors');
const { wrapError } = require('../util/diagnostics');
const { resolveId } = require('../managers');

function parseArguments(input) {
  const args = []; let value = '', quote = null, escaped = false, started = false;
  for (const char of input) {
    if (escaped) { value += char; escaped = false; started = true; }
    else if (char === '\\') { escaped = true; started = true; }
    else if (quote) { if (char === quote) quote = null; else value += char; }
    else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/u.test(char)) { if (started) { args.push(value); value = ''; started = false; } }
    else { value += char; started = true; }
  }
  if (quote) throw new YapperError('Unclosed quote in command arguments.', 'COMMAND_PARSE_ERROR');
  if (escaped) value += '\\'; if (started) args.push(value); return args;
}
class CommandContext {
  constructor(manager, message, command, args, rawArgs, prefix) { this.client = manager.client; this.manager = manager; this.message = message; this.command = command; this.args = args; this.rawArgs = rawArgs; this.prefix = prefix; }
  get author() { return this.message.author; }
  get authorId() { return this.message.authorId; }
  get channel() { return this.message.channel; }
  get guild() { return this.message.guild; }
  reply(content) { return this.message.reply(content); }
  async send(content) { const channel = this.channel ?? await this.client.channels.fetch(this.message.channelId); if (!channel) throw new YapperError('Command channel unavailable.', 'UNKNOWN_CHANNEL'); return channel.send(content); }
  async awaitReply(options = {}) {
    const channel = this.channel ?? await this.client.channels.fetch(this.message.channelId); if (!channel) throw new YapperError('Command channel unavailable.', 'UNKNOWN_CHANNEL');
    const filter = options.filter;
    return channel.awaitMessages({ ...options, max: 1, filter: async message => message.authorId === this.authorId && (!filter || await filter(message)) });
  }
}
class CommandManager {
  #aliases = new Map(); #cooldowns = new Map(); #active = true; #listener;
  constructor(client, options = {}) {
    Object.defineProperty(this, 'client', { value: client }); this.cache = new Collection();
    this.prefix = options.prefix ?? '!'; this.owners = new Set((options.owners ?? []).map(resolveId)); this.cooldown = options.cooldown ?? 0;
    this.ignoreBots = options.ignoreBots !== false; this.replyOnReject = options.replyOnReject === true;
    if (!(typeof this.prefix === 'function' || typeof this.prefix === 'string' || Array.isArray(this.prefix) && this.prefix.every(value => typeof value === 'string'))) throw new TypeError('prefix must be text, an array of prefixes or a function.');
    if (!Number.isFinite(this.cooldown) || this.cooldown < 0) throw new RangeError('Command cooldown is nonnegative milliseconds.');
    this.#listener = message => { this.handle(message).catch(error => this.client._emitError(wrapError(error, 'Command processing failed.', 'COMMAND_FAILED'))); };
    client.on(Events.MessageCreate, this.#listener);
  }
  register(command) {
    if (!command || typeof command !== 'object' || typeof command.execute !== 'function' || !/^[a-z][a-z0-9_-]{0,31}$/i.test(command.name)) throw new TypeError('A command needs a valid name and execute(context) function.');
    if (command.aliases !== undefined && (!Array.isArray(command.aliases) || command.aliases.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/i.test(name)))) throw new TypeError('Invalid command aliases.');
    if (command.authorize !== undefined && typeof command.authorize !== 'function') throw new TypeError('authorize must be a function.');
    for (const field of ['minArgs', 'maxArgs']) if (command[field] !== undefined && (!Number.isInteger(command[field]) || command[field] < 0)) throw new RangeError(`${field} must be a nonnegative integer.`);
    if (command.minArgs !== undefined && command.maxArgs !== undefined && command.minArgs > command.maxArgs) throw new RangeError('minArgs cannot exceed maxArgs.');
    if (command.cooldown !== undefined && (!Number.isFinite(command.cooldown) || command.cooldown < 0)) throw new RangeError('cooldown is nonnegative milliseconds.');
    if (command.guildOnly && command.dmOnly) throw new TypeError('A command cannot be both guildOnly and dmOnly.');
    const name = command.name.toLowerCase(), aliases = (command.aliases ?? []).map(alias => alias.toLowerCase());
    for (const key of [name, ...aliases]) if (this.cache.has(key) || this.#aliases.has(key)) throw new TypeError(`Command name or alias already registered: ${key}`);
    if (new Set([name, ...aliases]).size !== aliases.length + 1) throw new TypeError('Duplicate command aliases.');
    const entry = Object.freeze({ ...command, name, aliases: Object.freeze(aliases) }); this.cache.set(name, entry); for (const alias of aliases) this.#aliases.set(alias, name); return this;
  }
  resolve(name) { const key = name.toLowerCase(); return this.cache.get(this.#aliases.get(key) ?? key) ?? null; }
  unregister(name) { const command = this.resolve(name); if (!command) return false; this.cache.delete(command.name); for (const alias of command.aliases) this.#aliases.delete(alias); return true; }
  load(directory) {
    const absolute = path.resolve(directory);
    for (const file of fs.readdirSync(absolute, { withFileTypes: true }).filter(file => file.isFile() && /\.(c?js)$/.test(file.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      const loaded = require(path.join(absolute, file.name)); this.register(loaded.default ?? loaded);
    }
    return this;
  }
  async #reject(context, reason, retryAfter = 0) {
    this.client.emit(Events.CommandRejected, context, { reason, retryAfter });
    if (this.replyOnReject && this.#active && !this.client._isDestroyed) {
      const content = reason === 'cooldown' ? `Please wait ${Math.ceil(retryAfter / 1000)}s before using this command again.` : reason === 'args' ? `Usage: ${context.prefix}${context.command.name}${context.command.usage ? ' ' + context.command.usage : ''}` : 'This command is not available to you here.';
      await context.reply(content);
    }
    return false;
  }
  async handle(message) {
    if (!this.#active || !this.client.isReady() || typeof message.content !== 'string' || !message.authorId || message.authorId === this.client.userId || this.ignoreBots && message.author?.bot) return false;
    const configured = typeof this.prefix === 'function' ? await this.prefix(message) : this.prefix;
    const prefixes = (Array.isArray(configured) ? configured : [configured]).filter(value => typeof value === 'string' && value).sort((a, b) => b.length - a.length);
    const prefix = prefixes.find(prefix => message.content.startsWith(prefix)); if (!prefix) return false;
    const input = message.content.slice(prefix.length).trimStart(); const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(input); if (!match) return false;
    const command = this.resolve(match[1]); if (!command) return false;
    let args;
    try { args = parseArguments(match[2] ?? ''); } catch { this.client.emit(Events.CommandError, new YapperError('Invalid command arguments.', 'COMMAND_PARSE_ERROR'), { message, command }); return false; }
    const context = new CommandContext(this, message, command, args, match[2] ?? '', prefix);
    try {
      if (command.ownerOnly && !this.owners.has(message.authorId)) return this.#reject(context, 'ownerOnly');
      if (command.guildOnly && !message.guild) return this.#reject(context, 'guildOnly');
      if (command.dmOnly && message.guild) return this.#reject(context, 'dmOnly');
      if (command.authorize && !await command.authorize(context)) return this.#reject(context, 'authorization');
      if (!this.#active || this.client._isDestroyed) return false;
      if (args.length < (command.minArgs ?? 0) || args.length > (command.maxArgs ?? Infinity)) return this.#reject(context, 'args');
      const now = Date.now(), key = `${command.name}:${message.authorId}`;
      for (const [key, expiry] of this.#cooldowns) if (expiry <= now) this.#cooldowns.delete(key);
      const expiry = this.#cooldowns.get(key) ?? 0; if (expiry > now) return this.#reject(context, 'cooldown', expiry - now);
      const cooldown = command.cooldown ?? this.cooldown; if (cooldown > 0) this.#cooldowns.set(key, now + cooldown);
      while (this.#cooldowns.size > 10000) this.#cooldowns.delete(this.#cooldowns.keys().next().value);
      this.client.emit(Events.CommandStart, context); await command.execute(context); this.client.emit(Events.CommandFinish, context); return true;
    } catch (error) {
      this.client.emit(Events.CommandError, wrapError(error, 'Command handler failed.', 'COMMAND_FAILED'), context); return false;
    }
  }
  addHelpCommand({ name = 'help' } = {}) {
    return this.register({ name, description: 'List available commands', execute: async context => {
      const lines = this.cache.filter(command => !command.hidden && (!command.ownerOnly || this.owners.has(context.authorId)) && (!command.guildOnly || context.guild) && (!command.dmOnly || !context.guild)).map(command => `${context.prefix}${command.name}${command.usage ? ' ' + command.usage : ''}${command.description ? ' — ' + command.description : ''}`);
      // Chunk help text to avoid oversized messages; each chunk is a separate reply.
      let page = '';
      for (const line of lines) { if (page && page.length + line.length + 1 > 1800) { await context.reply(page); page = ''; } page += `${page ? '\n' : ''}${line}`; }
      if (page) await context.reply(page);
    } });
  }
  destroy() { this.#active = false; this.client.off(Events.MessageCreate, this.#listener); this.#cooldowns.clear(); }
}
module.exports = { CommandManager, CommandContext, parseArguments };
