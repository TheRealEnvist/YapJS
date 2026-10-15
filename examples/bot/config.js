'use strict';
// These fields are optional. Undefined values leave the corresponding profile field alone.
// Edit this file or supply environment variables before starting the example bot.
module.exports = {
  events: {
    logMessages: process.env.YAPPER_LOG_MESSAGES === '1',
    // Optional server ID -> text channel ID map for welcome/goodbye messages.
    // Example: { 'your-server-id': 'your-welcome-channel-id' }
    welcomeChannels: {},
  },
  commands: {
    enabled: process.env.YAPPER_ENABLE_COMMANDS !== '0',
    prefix: process.env.YAPPER_PREFIX || '!',
    owners: (process.env.YAPPER_OWNER_IDS || '').split(',').map(id => id.trim()).filter(Boolean),
    cooldown: 1000,
    replyOnReject: true,
  },
  profile: {
    bio: process.env.YAPPER_BIO,
    displayName: process.env.YAPPER_DISPLAY_NAME,
    customStatus: process.env.YAPPER_CUSTOM_STATUS,
    pronouns: process.env.YAPPER_PRONOUNS,
    accentColor: process.env.YAPPER_ACCENT_COLOR,
  },
  // Example: { status: 'dnd', activity: 'Helping with server setup' }.
  // A configured presence is kept alive automatically; omitted means no heartbeat.
  presence: process.env.YAPPER_STATUS || process.env.YAPPER_ACTIVITY
    ? { status: process.env.YAPPER_STATUS || 'online', ...(process.env.YAPPER_ACTIVITY ? { activity: process.env.YAPPER_ACTIVITY } : {}) }
    : undefined,
};
