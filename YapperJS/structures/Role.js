'use strict';
class Role {
  constructor(guild, data) {
    Object.defineProperty(this, 'guild', { value: guild }); Object.defineProperty(this, 'client', { value: guild.client });
    this.guildId = guild.id; this.permissions = Object.freeze({}); this.auto = 'none'; this._patch(data);
  }
  _patch(data) {
    if (data.server_id && data.server_id !== this.guildId) throw new TypeError('Role belongs to another server.');
    for (const [key, value] of Object.entries({ id: data.id, name: data.name, color: data.color, color2: data.color2, position: data.position, manageServer: data.manage_server, manageMessages: data.manage_messages, auto: data.auto, autoBefore: data.auto_before })) if (value !== undefined) this[key] = value;
    if (data.perms !== undefined) this.permissions = Object.freeze({ ...(data.perms ?? {}) }); return this;
  }
  get members() { return this.guild.members.cache.filter(member => member.roles.cache.has(this.id)); }
  edit(options) { return this.guild.roles.edit(this.id, options); }
  setName(name) { return this.edit({ name }); }
  setColor(color) { return this.edit({ color }); }
  setPermissions(permissions) { return this.edit({ permissions, manageServer: false, manageMessages: false }); }
  delete() { return this.guild.roles.delete(this.id); }
  toString() { return this.name ?? this.id; }
  toJSON() { return { id: this.id, guildId: this.guildId, name: this.name, color: this.color, color2: this.color2, position: this.position, manageServer: this.manageServer, manageMessages: this.manageMessages, permissions: this.permissions, auto: this.auto, autoBefore: this.autoBefore }; }
}
module.exports = Role;
