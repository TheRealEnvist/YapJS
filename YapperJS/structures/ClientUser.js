'use strict';
const { User } = require('./index');
const { AuthenticationError, YapperError } = require('../util/errors');
const { objectOptions, text } = require('../util/validation');
const { Events } = require('../util/constants');
const { profileFields } = require('../util/fields');

class ClientUser extends User {
  get presence() { return this.client.presence; }
  async edit(options) {
    if (!this.client.isReady() || this.client.user?.id !== this.id) throw new AuthenticationError();
    objectOptions(options, ['username', 'bio', 'displayName', 'pronouns', 'customStatus', 'accentColor', 'accentColor2', 'avatar', 'banner'], 'profile');
    const patch = {};
    if (options.username !== undefined) {
      const username = text(options.username, 'Username');
      if (!/^[A-Za-z0-9_.]{2,32}$/.test(username)) throw new TypeError('Usernames are 2–32 letters, numbers, dots or underscores.');
      patch.username = username;
    }
    if (options.bio !== undefined) patch.bio = text(options.bio, 'Bio', { max: 190, empty: true, trim: false });
    for (const [key, field] of [['displayName', 'display_name'], ['pronouns', 'pronouns'], ['customStatus', 'custom_status'], ['avatar', 'avatar_path'], ['banner', 'banner_path']]) {
      if (options[key] !== undefined) patch[field] = text(options[key], key, { nullable: true, empty: true, ...(key === 'customStatus' ? { max: 80 } : {}) }) || null;
    }
    for (const [key, field] of [['accentColor', 'accent_color'], ['accentColor2', 'accent_color2']]) {
      if (options[key] !== undefined) {
        if (options[key] !== null && (typeof options[key] !== 'string' || !/^#[\da-f]{6}$/i.test(options[key]))) throw new TypeError(`${key} must be a six-digit hex color or null.`);
        patch[field] = options[key];
      }
    }
    if (!Object.keys(patch).length) throw new TypeError('Supply at least one profile field.');
    const params = new URLSearchParams({ id: `eq.${this.id}`, select: profileFields });
    const rows = await this.client.rest.patch(`/rest/v1/profiles?${params}`, patch, { headers: { Prefer: 'return=representation' } });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== this.id) throw new YapperError('Profile update returned no matching record.', 'PROFILE_UPDATE_FAILED');
    const previous = new User(this.client, {}); Object.assign(previous, this);
    this._patch(rows[0]); this.client.users.cache.set(this.id, this);
    this.client.emit(Events.UserUpdate, previous, this); return this;
  }
  setBio(bio) { return this.edit({ bio }); }
  setUsername(username) { return this.edit({ username }); }
  setDisplayName(displayName) { return this.edit({ displayName }); }
  setPronouns(pronouns) { return this.edit({ pronouns }); }
  setCustomStatus(customStatus) { return this.edit({ customStatus }); }
  setAccentColor(accentColor) { return this.edit({ accentColor }); }
  setStatus(status) { return this.presence.setStatus(status); }
  setActivity(activity) { return this.presence.setActivity(activity); }
  setPresence(presence) { return this.presence.setPresence(presence); }
}
module.exports = ClientUser;
