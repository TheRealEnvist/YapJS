'use strict';
const { EventEmitter, captureRejectionSymbol } = require('node:events');
const Collection = require('../util/Collection');
const { text } = require('../util/validation');
const { YapperError } = require('../util/errors');
const { wrapError } = require('../util/diagnostics');
const { emojiName } = require('../reactions');
const { resolveId } = require('../managers');
class ReactionButtonBuilder {
  constructor(data = {}) { this.data = { ...data }; }
  setCustomId(customId) { this.data.customId = customId; return this; }
  setLabel(label) { this.data.label = label; return this; }
  setEmoji(emoji) { this.data.emoji = emoji; return this; }
  setDisabled(disabled = true) { this.data.disabled = disabled; return this; }
  toJSON() { return buttonData(this.data); }
}
function buttonData(button) {
  const data = button instanceof ReactionButtonBuilder ? button.data : button;
  if (!data || typeof data !== 'object' || !/^[a-z0-9_-]{1,100}$/i.test(data.customId)) throw new TypeError('Buttons need an alphanumeric customId (hyphens/underscores allowed).');
  if (data.disabled !== undefined && typeof data.disabled !== 'boolean') throw new TypeError('Button disabled must be a boolean.');
  return { customId: data.customId, label: text(data.label, 'Button label', { max: 80 }), emoji: emojiName(data.emoji), disabled: data.disabled ?? false };
}
function buttonsData(buttons) {
  if (!Array.isArray(buttons) || !buttons.length || buttons.length > 20) throw new RangeError('Supply 1–20 reaction buttons.');
  const data = buttons.map(buttonData);
  if (new Set(data.map(b => b.emoji)).size !== data.length || new Set(data.map(b => b.customId)).size !== data.length) throw new TypeError('Button emojis and custom IDs must be unique.');
  return data;
}
function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Interaction options must be an object.');
  for (const field of ['time', 'idle']) if (options[field] !== undefined && (!Number.isInteger(options[field]) || options[field] < 1 || options[field] > 2147483647)) throw new RangeError(`${field} must be a positive integer below 2147483648.`);
  for (const field of ['onSelect', 'filter']) if (options[field] !== undefined && typeof options[field] !== 'function') throw new TypeError(`${field} must be a function.`);
  for (const field of ['once', 'public', 'updateOnEnd']) if (options[field] !== undefined && typeof options[field] !== 'boolean') throw new TypeError(`${field} must be a boolean.`);
}
function audience(options) {
  if (options.public === true) return null;
  if (!Array.isArray(options.allowedUserIds) || !options.allowedUserIds.length) throw new TypeError('Supply allowedUserIds, or explicitly use public: true.');
  return new Set(options.allowedUserIds.map(resolveId));
}
const legend = buttons => buttons.map(button => `${button.emoji} ${button.label}${button.disabled ? ' (disabled)' : ''}`).join(' · ');
class ReactionInteraction {
  constructor(menu, button, reaction, user) { this.menu = menu; this.button = button; this.customId = button.customId; this.reaction = reaction; this.user = user; this.message = menu.message; }
  reply(content) { return this.message.reply(content); }
  update(content) { if (this.menu.ended) return Promise.reject(new YapperError('Reaction menu has ended.', 'MENU_ENDED')); return this.message.edit(content); }
  stop(reason = 'selected') { this.menu.stop(reason); }
}
class ReactionMenu extends EventEmitter {
  #queue = Promise.resolve(); #claimed = false;
  constructor(message, options, data, allowed) {
    super({ captureRejections: true }); Object.defineProperty(this, 'message', { value: message });
    this.buttons = new Collection(data.map(button => [button.customId, button])); this.selected = null;
    this.collector = message.createReactionCollector({ time: options.time ?? 60000, idle: options.idle,
      filter: async (reaction, user) => user.id !== message.client.userId && (!allowed || allowed.has(user.id)) && data.some(button => button.emoji === reaction.emoji.name && !this.buttons.get(button.customId).disabled) && (!options.filter || await options.filter(reaction, user)) });
    this.finished = this.collector.finished;
    this.collector.on('collect', (reaction, user) => {
      if (options.once && this.#claimed) return; if (options.once) this.#claimed = true;
      this.#queue = this.#queue.then(async () => {
        if (this.ended) return;
        const button = [...this.buttons.values()].find(button => button.emoji === reaction.emoji.name);
        if (!button || button.disabled) return;
        const interaction = new ReactionInteraction(this, button, reaction, user); this.selected = interaction;
        if (options.onSelect) await options.onSelect(interaction);
        this.emit('select', interaction); if (options.once) this.stop('selected');
      }).catch(error => { message.client._emitError(wrapError(error, 'Reaction menu action failed.', 'MENU_ACTION_FAILED')); this.stop('error'); });
    });
    this.collector.on('end', (collected, reason) => this.emit('end', collected, reason));
  }
  get ended() { return this.collector.ended; }
  stop(reason = 'user') { this.collector.stop(reason); }
  setDisabled(customId, disabled = true) { if (typeof disabled !== 'boolean' || !this.buttons.has(customId)) throw new TypeError('Invalid button or disabled state.'); this.buttons.get(customId).disabled = disabled; return this; }
  [captureRejectionSymbol]() { this.message.client._emitError(new YapperError('An async menu listener rejected.', 'MENU_LISTENER_ERROR')); this.stop('error'); }
  static async create(message, options) {
    validateOptions(options);
    const data = buttonsData(options.buttons), allowed = audience(options);
    if (options.onSelect !== undefined && typeof options.onSelect !== 'function' || options.filter !== undefined && typeof options.filter !== 'function') throw new TypeError('Menu callbacks must be functions.');
    const menu = new ReactionMenu(message, options, data, allowed);
    try { for (const button of data) await message.react(button.emoji); }
    catch (error) { menu.stop('seedError'); throw error; }
    return menu;
  }
  static async send(channel, options) {
    validateOptions(options);
    const data = buttonsData(options.buttons); audience(options);
    const content = text(options.content, 'Menu content');
    const message = await channel.send(`${content}\n\n${legend(data)}`);
    return this.create(message, { ...options, buttons: data });
  }
  static async paginate(channel, pages, options = {}) {
    validateOptions(options);
    if (!Array.isArray(pages) || !pages.length || pages.length > 100 || pages.some(page => typeof page !== 'string' || !page.trim())) throw new TypeError('Supply 1–100 nonempty text pages.');
    audience(options);
    let index = 0;
    const buttons = [{ customId: 'previous', label: 'Previous', emoji: '⬅️' }, { customId: 'next', label: 'Next', emoji: '➡️' }, { customId: 'close', label: 'Close', emoji: '⏹️' }];
    const render = () => `${pages[index]}\n\nPage ${index + 1}/${pages.length}\n${legend(buttons)}`;
    const message = await channel.send(render());
    return this.create(message, { ...options, buttons, onSelect: async interaction => {
      if (interaction.customId === 'close') { interaction.stop('closed'); return; }
      index = interaction.customId === 'next' ? Math.min(pages.length - 1, index + 1) : Math.max(0, index - 1);
      await interaction.update(render());
      if (options.onSelect) await options.onSelect(interaction);
    } });
  }
  static async confirm(channel, options) {
    const menu = await this.send(channel, { ...options, once: true, buttons: [{ customId: 'confirm', label: 'Confirm', emoji: '✅' }, { customId: 'cancel', label: 'Cancel', emoji: '❌' }] });
    const { reason } = await menu.finished;
    return { confirmed: reason === 'selected' && menu.selected?.customId === 'confirm', user: menu.selected?.user ?? null, reason, message: menu.message };
  }
}
const voteEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
class ReactionPoll extends EventEmitter {
  constructor(message, choices, options) {
    super({ captureRejections: true }); this.message = message; this.choices = choices; this.votes = new Collection();
    this.collector = message.createReactionCollector({ time: options.time ?? 60000, dispose: true,
      filter: (reaction, user) => user.id !== message.client.userId && choices.some(choice => choice.emoji === reaction.emoji.name) });
    this.collector.on('collect', (reaction, user) => { this.votes.set(user.id, reaction.emoji.name); this.emit('vote', user, reaction.emoji.name); });
    this.collector.on('remove', (reaction, user) => { if (this.votes.get(user.id) === reaction.emoji.name) { this.votes.delete(user.id); this.emit('voteRemove', user, reaction.emoji.name); } });
    this.finished = this.collector.finished.then(async ({ reason }) => {
      const results = this.results();
      if (options.updateOnEnd !== false && this.message.client.isReady() && !['messageDelete', 'channelDelete', 'guildDelete', 'clientDestroy', 'seedError'].includes(reason)) {
        try { await message.edit(`${options.question}\n\n${results.map(choice => `${choice.emoji} ${choice.label}: ${choice.votes}`).join('\n')}\n\nPoll closed.`); }
        catch (error) { message.client._emitError(wrapError(error, 'Could not update poll results.', 'POLL_UPDATE_FAILED')); }
      }
      this.emit('end', results, reason); return { results, reason };
    });
  }
  results() { return this.choices.map(choice => ({ ...choice, votes: [...this.votes.values()].filter(emoji => emoji === choice.emoji).length })); }
  stop(reason = 'user') { this.collector.stop(reason); }
  get ended() { return this.collector.ended; }
  [captureRejectionSymbol]() { this.message.client._emitError(new YapperError('An async poll listener rejected.', 'POLL_LISTENER_ERROR')); }
  static async create(channel, options) {
    validateOptions(options);
    const question = text(options.question, 'Poll question', { max: 500 });
    if (!Array.isArray(options.choices) || options.choices.length < 2 || options.choices.length > 10) throw new RangeError('Polls need 2–10 choices.');
    const choices = options.choices.map((choice, index) => ({ label: text(typeof choice === 'string' ? choice : choice.label, 'Poll choice', { max: 100 }), emoji: typeof choice === 'string' ? voteEmojis[index] : emojiName(choice.emoji) }));
    if (new Set(choices.map(choice => choice.emoji)).size !== choices.length) throw new TypeError('Poll emojis must be unique.');
    const message = await channel.send(`${question}\n\n${choices.map(choice => `${choice.emoji} ${choice.label}`).join('\n')}\n\nReact to vote. One vote each; your latest choice counts.`);
    const poll = new ReactionPoll(message, choices, { ...options, question });
    try { for (const choice of choices) await message.react(choice.emoji); } catch (error) { poll.stop('seedError'); throw error; }
    return poll;
  }
}
module.exports = { ReactionButtonBuilder, ReactionInteraction, ReactionMenu, ReactionPoll };
