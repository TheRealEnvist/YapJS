export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
export interface Activity { name: string; since?: number }
export interface PresenceOptions { status?: PresenceStatus; activity?: string | Activity | null }
export interface PresenceData { status: PresenceStatus; activity: { name: string; since: number } | null }
export interface ProfileEditOptions {
  username?: string; bio?: string; displayName?: string | null; pronouns?: string | null;
  customStatus?: string | null; accentColor?: string | null; accentColor2?: string | null;
  /** Existing storage path, or null to clear. Uploading files is not implemented. */
  avatar?: string | null; banner?: string | null;
}
export interface CreateChannelOptions { name: string; type?: 'text' | 'voice' }
export interface EditChannelOptions { name?: string; noImages?: boolean }
export interface ChannelAccessOptions { private: boolean; roleIds?: (string | { id: string })[] }
export interface ChannelPostingOptions { readOnly: boolean; roleIds?: (string | { id: string })[]; slowmode?: number }
export interface ServerEditOptions { name?: string; icon?: string | null }
export interface ServerDiscoveryOptions { discoverable?: boolean; description?: string; tags?: string[] }
export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user?: { id: string; user_metadata?: Record<string, unknown>; [key: string]: unknown };
}
export type SessionInput = Session | { refresh_token: string; access_token?: string } | string;
export interface SessionStore {
  load(): Session | null | Promise<Session | null>;
  save(session: Session): void | Promise<void>;
  clear?(): void | Promise<void>;
}
export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Public media CDN used for avatar URLs. Defaults to Yapper's media host. */
  mediaBaseUrl?: string;
  gatewayUrl?: string;
  sessionStore?: SessionStore;
  realtime?: boolean;
  autoRefresh?: boolean;
  /** Milliseconds before expiry; defaults to 60,000. */
  refreshMargin?: number;
  /** Initial and maximum automatic refresh retry delays (ms), defaults 5000/300000. */
  refreshRetryDelay?: number; refreshRetryMaxDelay?: number;
  requestTimeout?: number;
  gatewayTimeout?: number;
  messageCacheMaxSize?: number;
  presence?: PresenceOptions;
  /** Heartbeat interval in milliseconds; defaults to 45,000. */
  presenceInterval?: number;
  commands?: CommandManagerOptions;
  fetch?: (url: string, options: any) => Promise<any>;
  WebSocket?: new (url: string) => any;
}
export const Events: Readonly<{
  ClientReady: 'clientReady'; Ready: 'ready'; Error: 'error'; Warn: 'warn';
  RefreshRetry: 'refreshRetry'; SessionInvalidated: 'sessionInvalidated';
  TokenRefresh: 'tokenRefresh'; SessionUpdate: 'sessionUpdate';
  MessageReactionAdd: 'messageReactionAdd'; MessageReactionRemove: 'messageReactionRemove';
  CommandStart: 'commandStart'; CommandFinish: 'commandFinish'; CommandError: 'commandError'; CommandRejected: 'commandRejected'; TypingStart: 'typingStart';
  MessageCreate: 'messageCreate'; MessageUpdate: 'messageUpdate'; MessageDelete: 'messageDelete';
  ChannelCreate: 'channelCreate'; ChannelUpdate: 'channelUpdate'; ChannelDelete: 'channelDelete';
  RoleCreate: 'roleCreate'; RoleUpdate: 'roleUpdate'; RoleDelete: 'roleDelete';
  GuildMemberAdd: 'guildMemberAdd'; GuildMemberRemove: 'guildMemberRemove'; GuildMemberUpdate: 'guildMemberUpdate';
  GuildCreate: 'guildCreate'; GuildUpdate: 'guildUpdate'; GuildDelete: 'guildDelete';
  UserUpdate: 'userUpdate'; PresenceUpdate: 'presenceUpdate'; Raw: 'raw'; GatewayReady: 'gatewayReady';
  GatewayDisconnect: 'gatewayDisconnect'; GatewayReconnect: 'gatewayReconnect'; Destroyed: 'destroyed';
}>;
export const ChannelType: Readonly<{ GuildText: 'text'; GuildVoice: 'voice'; DM: 'dm'; GroupDM: 'group' }>;
export interface ClientEvents {
  clientReady: [client: Client & { user: ClientUser; readyAt: Date }];
  ready: [client: Client & { user: ClientUser; readyAt: Date }];
  error: [error: Error]; warn: [warning: string];
  refreshRetry: [metadata: { attempt: number; retryIn: number; code: string; status: number | null }];
  sessionInvalidated: [metadata: { code: string; status: number | null }];
  tokenRefresh: [metadata: { expiresAt: number | null }];
  sessionUpdate: [metadata: { expiresAt: number | null }];
  messageCreate: [message: Message]; messageUpdate: [oldMessage: Message | null, newMessage: Message]; messageDelete: [message: Message];
  messageReactionAdd: [reaction: MessageReaction, user: User]; messageReactionRemove: [reaction: MessageReaction, user: User];
  commandStart: [context: CommandContext]; commandFinish: [context: CommandContext];
  commandError: [error: YapperError, context: CommandContext | { message: Message; command: CommandDefinition }];
  commandRejected: [context: CommandContext, info: { reason: string; retryAfter: number }];
  typingStart: [payload: Record<string, unknown>];
  channelCreate: [channel: Channel]; channelUpdate: [oldChannel: Channel | null, newChannel: Channel]; channelDelete: [channel: Channel];
  roleCreate: [role: Role]; roleUpdate: [oldRole: Role | null, newRole: Role]; roleDelete: [role: Role];
  guildMemberAdd: [member: GuildMember]; guildMemberRemove: [member: GuildMember];
  guildMemberUpdate: [oldMember: GuildMember | null, newMember: GuildMember];
  guildCreate: [guild: Guild]; guildUpdate: [oldGuild: Guild | null, newGuild: Guild]; guildDelete: [guild: Guild];
  userUpdate: [oldUser: User | null, newUser: User];
  presenceUpdate: [oldPresence: PresenceData, newPresence: PresenceData];
  raw: [event: string, payload: Record<string, any>]; gatewayReady: [];
  gatewayDisconnect: [info: { code: number }]; gatewayReconnect: []; destroyed: [];
}
export class Collection<K, V> extends Map<K, V> {
  first(): V | undefined;
  first(count: number): V[];
  last(): V | undefined;
  last(count: number): V[];
  find(predicate: (value: V, key: K, collection: this) => unknown, thisArg?: unknown): V | undefined;
  filter(predicate: (value: V, key: K, collection: this) => unknown, thisArg?: unknown): Collection<K, V>;
  map<T>(predicate: (value: V, key: K, collection: this) => T, thisArg?: unknown): T[];
  some(predicate: (value: V, key: K, collection: this) => unknown, thisArg?: unknown): boolean;
  every(predicate: (value: V, key: K, collection: this) => unknown, thisArg?: unknown): boolean;
  reduce<T>(predicate: (previous: T, value: V, key: K, collection: this) => T, initial: T): T;
  reduce(predicate: (previous: V, value: V, key: K, collection: this) => V): V;
  clone(): Collection<K, V>;
  toJSON(): unknown[];
}
export class Client {
  constructor(options?: ClientOptions);
  static create(yapperValue: string, apiKey: string, insecureLogin?: boolean): Promise<Client>;
  readonly apiKey: string;
  readonly token: string | null;
  readonly refresh_token: string | null;
  readonly refreshtoken: string | null;
  readonly userId: string | null;
  readonly botProfile: Session['user'] | null;
  readonly uptime: number | null;
  user: ClientUser | null;
  readyAt: Date | null;
  bootstrapData: Record<string, any> | null;
  users: UserManager;
  dms: DMManager;
  channels: ChannelManager;
  guilds: GuildManager;
  servers: GuildManager;
  rest: REST;
  presence: PresenceManager;
  commands: CommandManager;
  auth: {
    readonly requiresLogin: boolean;
    readonly accessToken: string | null; readonly refreshToken: string | null; readonly expiresAt: number | null;
    getAccessToken(): Promise<string>; getSession(): Promise<Session>; refresh(): Promise<Session>;
  };
  gateway: {
    readonly connected: boolean;
    sendTyping(channelId: string, recipients?: string[]): boolean;
    watch(channel: string | { id: string }): void;
    unwatch(channel: string | { id: string }): void;
  };
  login(session?: SessionInput): Promise<this>;
  createDM(user: string | { id: string }, options?: { force?: boolean }): Promise<Channel>;
  sendDM(user: string | { id: string }, content: string | MessageOptions): Promise<Message>;
  setPresence(options: PresenceOptions): Promise<PresenceManager>;
  refreshToken(legacyClient?: Client): Promise<Session>;
  fetchBootstrap(): Promise<Record<string, any>>;
  isReady(): this is this & { user: ClientUser; readyAt: Date };
  destroy(): void;
  on<E extends keyof ClientEvents>(event: E, listener: (...args: ClientEvents[E]) => void | Promise<void>): this;
  once<E extends keyof ClientEvents>(event: E, listener: (...args: ClientEvents[E]) => void | Promise<void>): this;
  off<E extends keyof ClientEvents>(event: E, listener: (...args: ClientEvents[E]) => void | Promise<void>): this;
  removeAllListeners(event?: keyof ClientEvents): this;
  toJSON(): Record<string, unknown>;
}
export { Client as Yapper };
export interface MessageOptions { content: string; replyTo?: string | { id: string } }
export class User {
  readonly client: Client; id: string; username?: string; displayName?: string | null; avatar?: string | null; bio?: string; bot?: boolean;
  customStatus?: string | null; pronouns?: string | null; accentColor?: string | null; accentColor2?: string | null; banner?: string | null;
  displayAvatarURL(): string | null;
  readonly dmChannel: Channel | null;
  createDM(options?: { force?: boolean }): Promise<Channel>;
  send(content: string | MessageOptions): Promise<Message>;
  toJSON(): Record<string, unknown>;
}
export class Channel {
  readonly client: Client; id: string; name?: string; type?: string; guildId?: string | null; topic?: string;
  readonly guild: Guild | null;
  memberIds?: string[];
  messages: MessageManager;
  noImages?: boolean; readOnly?: boolean; slowmode?: number; private?: boolean; position?: number;
  isDMBased(): boolean; isTextBased(): boolean;
  send(content: string | MessageOptions): Promise<Message>;
  createMessageCollector(options?: CollectorOptions<[Message]>): MessageCollector;
  awaitMessages(options?: CollectorOptions<[Message]>): Promise<Collection<string, Message>>;
  sendTyping(): boolean;
  sendReactionMenu(options: ReactionMenuSendOptions): Promise<ReactionMenu>;
  paginate(pages: string[], options: ReactionPaginationOptions): Promise<ReactionMenu>;
  confirm(options: ReactionConfirmOptions): Promise<ConfirmationResult>;
  createPoll(options: ReactionPollOptions): Promise<ReactionPoll>;
  edit(options: EditChannelOptions): Promise<Channel>;
  setName(name: string): Promise<Channel>;
  setNoImages(noImages: boolean): Promise<Channel>;
  setAccess(options: ChannelAccessOptions): Promise<Channel>;
  setPosting(options: ChannelPostingOptions): Promise<Channel>;
  delete(): Promise<Channel>;
  bulkDelete(messages: number | (string | Message)[] | Collection<string, Message>): Promise<Collection<string, Message>>;
  toJSON(): Record<string, unknown>;
}
export class Guild {
  readonly client: Client; id: string; name?: string; ownerId?: string; icon?: string; description?: string;
  readonly channels: GuildChannelManager;
  readonly roles: GuildRoleManager; readonly bans: GuildBanManager;
  discoverable?: boolean; tags?: string[]; tag?: string | null;
  readonly members: GuildMemberManager;
  edit(options: ServerEditOptions): Promise<Guild>;
  setName(name: string): Promise<Guild>;
  setIcon(icon: string | null): Promise<Guild>;
  setDescription(description: string): Promise<Guild>;
  setDiscovery(options: ServerDiscoveryOptions): Promise<Guild>;
  setNickname(user: string | { id: string }, nickname: string | null): Promise<void>;
  leave(): Promise<Guild | null>;
  delete(): Promise<Guild | null>;
  toJSON(): Record<string, unknown>;
}
export { Guild as Server };
export class GuildMember {
  readonly client: Client; readonly guild: Guild; id: string; guildId: string;
  nickname: string | null; joinedTimestamp: number | null;
  readonly roles: GuildMemberRoleManager;
  kick(): Promise<void>; ban(): Promise<GuildBan>;
  timeout(duration: number, reason?: string): Promise<void>;
  readonly user: User | null; readonly displayName: string; readonly joinedAt: Date | null; readonly partial: boolean;
  fetch(): Promise<GuildMember | null>;
  setNickname(nickname: string | null): Promise<void>;
  toJSON(): { id: string; guildId: string; nickname: string | null; joinedTimestamp: number | null };
}
export class GuildMemberManager extends Collection<string, GuildMember> {
  readonly client: Client; readonly guild: Guild; readonly cache: this;
  kick(user: string | { id: string }): Promise<void>; ban(user: string | { id: string }): Promise<GuildBan>;
  timeout(user: string | { id: string }, duration: number, reason?: string): Promise<void>;
  setNickname(user: string | { id: string }, nickname: string | null): Promise<void>;
  resolve(value: string | { id: string }): GuildMember | null;
  fetch(): Promise<this>;
  fetch(value: string | { id: string }, options?: { force?: boolean }): Promise<GuildMember | null>;
}
export class Message {
  readonly client: Client; id: string; channelId: string; authorId?: string; content?: string;
  createdTimestamp?: number; editedTimestamp?: number | null; replyToId?: string | null; attachmentPath?: string | null;
  readonly channel: Channel | null; readonly author: User | null; readonly guild: Guild | null; readonly createdAt: Date | null;
  readonly guildId: string | null; readonly member: GuildMember | null;
  inGuild(): boolean;
  readonly partial: boolean;
  readonly reactions: ReactionManager;
  fetch(): Promise<Message>;
  react(emoji: string | { name: string }): Promise<MessageReaction>;
  createReactionCollector(options?: CollectorOptions<[MessageReaction, User]>): ReactionCollector;
  awaitReactions(options?: CollectorOptions<[MessageReaction, User]>): Promise<Collection<string, MessageReaction>>;
  createReactionMenu(options: ReactionMenuOptions): Promise<ReactionMenu>;
  setReactionRoles(pairs: { emoji: string; roleId: string | { id: string } }[]): Promise<Message>;
  reply(content: string | MessageOptions): Promise<Message>;
  edit(content: string | MessageOptions): Promise<Message>;
  delete(): Promise<this>;
  toJSON(): Record<string, unknown>;
}
export class UserManager {
  createDM(user: string | { id: string }, options?: { force?: boolean }): Promise<Channel>;
  send(user: string | { id: string }, content: string | MessageOptions): Promise<Message>;
  cache: Collection<string, User>;
  resolve(value: string | User): User | null;
  fetch(): Promise<Collection<string, User>>;
  fetch(value: undefined, options: { force: boolean }): Promise<Collection<string, User>>;
  fetch(value: string | { id: string }, options?: { force?: boolean }): Promise<User | null>;
}
export class ChannelManager {
  cache: Collection<string, Channel>;
  resolve(value: string | Channel): Channel | null;
  fetch(): Promise<Collection<string, Channel>>;
  fetch(value: undefined, options: { force: boolean }): Promise<Collection<string, Channel>>;
  fetch(value: string | { id: string }, options?: { force?: boolean }): Promise<Channel | null>;
  create(options: CreateChannelOptions & { guildId: string | { id: string } }): Promise<Channel>;
  edit(channel: string | { id: string }, options: EditChannelOptions): Promise<Channel>;
  delete(channel: string | { id: string }): Promise<Channel>;
  setAccess(channel: string | { id: string }, options: ChannelAccessOptions): Promise<Channel>;
  setPosting(channel: string | { id: string }, options: ChannelPostingOptions): Promise<Channel>;
  fetchGuild(guild: string | { id: string }): Promise<Collection<string, Channel>>;
}
export class GuildManager {
  cache: Collection<string, Guild>;
  create(options: string | (ServerEditOptions & { name: string })): Promise<Guild>;
  edit(guild: string | { id: string }, options: ServerEditOptions): Promise<Guild>;
  delete(guild: string | { id: string }): Promise<Guild | null>;
  leave(guild: string | { id: string }): Promise<Guild | null>;
  setDiscovery(guild: string | { id: string }, options: ServerDiscoveryOptions): Promise<Guild>;
  setNickname(guild: string | { id: string }, user: string | { id: string }, nickname: string | null): Promise<void>;
  resolve(value: string | Guild): Guild | null;
  fetch(): Promise<Collection<string, Guild>>;
  fetch(value: undefined, options: { force: boolean }): Promise<Collection<string, Guild>>;
  fetch(value: string | { id: string }, options?: { force?: boolean }): Promise<Guild | null>;
}
export class MessageManager {
  bulkDelete(messages: number | (string | Message)[] | Collection<string, Message>): Promise<Collection<string, Message>>;
  cache: Collection<string, Message>;
  fetch(options?: { limit?: number; before?: string | Date | number }): Promise<Collection<string, Message>>;
  fetch(message: string | { id: string }, options?: { force?: boolean }): Promise<Message | null>;
  create(content: string | MessageOptions): Promise<Message>;
  edit(message: string | { id: string }, content: string | MessageOptions): Promise<Message>;
  delete(message: string | { id: string }): Promise<void>;
}
export class REST {
  constructor(client: Client, options?: ClientOptions);
  baseUrl: string;
  request(route: string, options?: { method?: string; body?: unknown; headers?: Record<string, string>; auth?: boolean; retry?: boolean; accessToken?: string }): Promise<any>;
  get(route: string, options?: Record<string, unknown>): Promise<any>;
  post(route: string, body?: unknown, options?: Record<string, unknown>): Promise<any>;
  patch(route: string, body?: unknown, options?: Record<string, unknown>): Promise<any>;
  delete(route: string, options?: Record<string, unknown>): Promise<any>;
  rpc(name: string, body?: Record<string, unknown>): Promise<any>;
}
export class MemorySessionStore implements SessionStore {
  load(): Promise<Session | null>; save(session: Session): Promise<void>; clear(): Promise<void>;
}
export class FileSessionStore implements SessionStore {
  constructor(filePath: string); path: string;
  load(): Promise<Session | null>; save(session: Session): Promise<void>; clear(): Promise<void>;
}
export class EncryptedFileSessionStore extends FileSessionStore {
  constructor(filePath: string, key: string | Uint8Array);
}
export class YapperError extends Error {
  code: string;
  /** Sanitized HTTP metadata retained by command/menu/poll error wrappers. */
  request?: Readonly<{ status: number; method: string; route: string; code: string; retryAfter: number | null }>;
}
export class YapperAPIError extends YapperError { status: number; method: string; route: string; retryAfter: number | null; }
export class AuthenticationError extends YapperError {}
export class SessionStorageError extends YapperError {}
export function decodeYapperValue(value: string): Session;

export class ClientUser extends User {
  readonly presence: PresenceManager;
  edit(options: ProfileEditOptions): Promise<this>;
  setBio(bio: string): Promise<this>;
  setUsername(username: string): Promise<this>;
  setDisplayName(displayName: string | null): Promise<this>;
  setPronouns(pronouns: string | null): Promise<this>;
  setCustomStatus(customStatus: string | null): Promise<this>;
  setAccentColor(accentColor: string | null): Promise<this>;
  setPresence(options: PresenceOptions): Promise<PresenceManager>;
  setStatus(status: PresenceStatus): Promise<PresenceManager>;
  setActivity(activity: string | Activity | null): Promise<PresenceManager>;
}
export class PresenceManager {
  constructor(client: Client, interval?: number);
  readonly status: PresenceStatus;
  readonly activity: { name: string; since: number } | null;
  readonly enabled: boolean;
  setPresence(options: PresenceOptions): Promise<this>;
  setStatus(status: PresenceStatus): Promise<this>;
  setActivity(activity: string | Activity | null): Promise<this>;
  heartbeat(): Promise<this>;
  destroy(): void;
  toJSON(): PresenceData;
}
export class GuildChannelManager {
  constructor(guild: Guild);
  readonly guild: Guild;
  readonly cache: Collection<string, Channel>;
  resolve(channel: string | { id: string }): Channel | null;
  fetch(): Promise<Collection<string, Channel>>;
  fetch(channel: string | { id: string }, options?: { force?: boolean }): Promise<Channel | null>;
  create(options: CreateChannelOptions): Promise<Channel>;
  edit(channel: string | { id: string }, options: EditChannelOptions): Promise<Channel>;
  delete(channel: string | { id: string }): Promise<Channel>;
  setPositions(order: (string | { id: string })[]): Promise<Collection<string, Channel>>;
}

export interface CollectorOptions<Args extends unknown[]> {
  filter?: (...args: Args) => unknown | Promise<unknown>;
  time?: number; idle?: number; max?: number; dispose?: boolean; errors?: string[];
}
export class Collector<T, Args extends unknown[]> {
  constructor(client: Client, options?: CollectorOptions<Args>);
  collected: Collection<string, T>; total: number;
  readonly ended: boolean; readonly endReason: string | null;
  readonly lastCollectedTimestamp: number | null;
  readonly finished: Promise<{ collected: Collection<string, T>; reason: string }>;
  readonly next: Promise<T>;
  resetTimer(options?: { time?: number; idle?: number }): this;
  stop(reason?: string): void;
  on(event: 'collect' | 'ignore' | 'remove', listener: (...args: Args) => void | Promise<void>): this;
  on(event: 'end', listener: (collected: Collection<string, T>, reason: string) => void | Promise<void>): this;
  once(event: 'collect' | 'ignore' | 'remove', listener: (...args: Args) => void | Promise<void>): this;
  once(event: 'end', listener: (collected: Collection<string, T>, reason: string) => void | Promise<void>): this;
  off(event: string, listener: (...args: any[]) => unknown): this;
}
export class MessageCollector extends Collector<Message, [Message]> {
  constructor(channel: Channel, options?: CollectorOptions<[Message]>);
  readonly channel: Channel;
}
export class ReactionCollector extends Collector<MessageReaction, [MessageReaction, User]> {
  constructor(message: Message, options?: CollectorOptions<[MessageReaction, User]>);
  readonly message: Message;
}
export class CollectorError extends YapperError { collected: Collection<string, unknown>; reason: string }
export class MessageReaction {
  readonly message: Message;
  readonly emoji: { name: string };
  readonly count: number; readonly me: boolean;
  users: { cache: Collection<string, User>; fetch(): Promise<Collection<string, User>> };
  remove(): Promise<Message>;
  toJSON(): { emoji: string; messageId: string; count: number; me: boolean };
}
export class ReactionManager {
  readonly message: Message;
  cache: Collection<string, MessageReaction>;
  fetch(): Promise<Collection<string, MessageReaction>>;
  add(emoji: string | { name: string }): Promise<MessageReaction>;
  /** Removes the logged-in user's own reaction only. */
  remove(emoji: string | { name: string }): Promise<Message>;
  /** Removes only the logged-in user's own reactions. */
  removeAll(): Promise<Message>;
  setRoles(pairs: { emoji: string; roleId: string | { id: string } }[]): Promise<Message>;
}
export interface CommandDefinition {
  name: string; aliases?: readonly string[]; description?: string; usage?: string;
  hidden?: boolean; ownerOnly?: boolean; guildOnly?: boolean; dmOnly?: boolean;
  cooldown?: number; minArgs?: number; maxArgs?: number;
  authorize?: (context: CommandContext) => boolean | Promise<boolean>;
  execute(context: CommandContext): unknown | Promise<unknown>;
}
export interface CommandManagerOptions {
  prefix?: string | string[] | ((message: Message) => string | string[] | Promise<string | string[]>);
  owners?: (string | { id: string })[];
  cooldown?: number; ignoreBots?: boolean; replyOnReject?: boolean;
}
export class CommandContext {
  readonly client: Client; readonly manager: CommandManager; readonly message: Message;
  readonly command: CommandDefinition; readonly args: string[]; readonly rawArgs: string; readonly prefix: string;
  readonly author: User | null; readonly authorId: string;
  readonly channel: Channel | null; readonly guild: Guild | null;
  reply(content: string | MessageOptions): Promise<Message>;
  send(content: string | MessageOptions): Promise<Message>;
  awaitReply(options?: CollectorOptions<[Message]>): Promise<Collection<string, Message>>;
}
export class CommandManager {
  constructor(client: Client, options?: CommandManagerOptions);
  cache: Collection<string, CommandDefinition>;
  prefix: NonNullable<CommandManagerOptions['prefix']>;
  owners: Set<string>; cooldown: number;
  register(command: CommandDefinition): this;
  resolve(name: string): CommandDefinition | null;
  unregister(name: string): boolean;
  load(directory: string): this;
  addHelpCommand(options?: { name?: string }): this;
  handle(message: Message): Promise<boolean>;
  destroy(): void;
}
export function parseArguments(input: string): string[];
export interface ReactionButtonData { customId: string; label: string; emoji: string; disabled?: boolean }
export class ReactionButtonBuilder {
  constructor(data?: Partial<ReactionButtonData>);
  setCustomId(id: string): this; setLabel(label: string): this; setEmoji(emoji: string): this; setDisabled(disabled?: boolean): this;
  toJSON(): ReactionButtonData;
}
export type ReactionAudience = { allowedUserIds: (string | { id: string })[]; public?: false } | { public: true; allowedUserIds?: (string | { id: string })[] };
export interface ReactionTiming { time?: number; idle?: number }
export type ReactionPaginationOptions = ReactionAudience & ReactionTiming & {
  onSelect?: (interaction: ReactionInteraction) => unknown | Promise<unknown>;
};
export type ReactionMenuOptions = ReactionAudience & ReactionTiming & {
  buttons: (ReactionButtonData | ReactionButtonBuilder)[];
  once?: boolean;
  filter?: (reaction: MessageReaction, user: User) => unknown | Promise<unknown>;
  onSelect?: (interaction: ReactionInteraction) => unknown | Promise<unknown>;
};
export type ReactionMenuSendOptions = ReactionMenuOptions & { content: string };
export type ReactionConfirmOptions = ReactionAudience & ReactionTiming & { content: string };
export interface ConfirmationResult { confirmed: boolean; user: User | null; reason: string; message: Message }
export class ReactionInteraction {
  readonly menu: ReactionMenu; readonly message: Message; readonly user: User;
  readonly reaction: MessageReaction; readonly button: ReactionButtonData; readonly customId: string;
  reply(content: string | MessageOptions): Promise<Message>;
  update(content: string | MessageOptions): Promise<Message>;
  stop(reason?: string): void;
}
export class ReactionMenu {
  static create(message: Message, options: ReactionMenuOptions): Promise<ReactionMenu>;
  static send(channel: Channel, options: ReactionMenuSendOptions): Promise<ReactionMenu>;
  static paginate(channel: Channel, pages: string[], options: ReactionPaginationOptions): Promise<ReactionMenu>;
  static confirm(channel: Channel, options: ReactionConfirmOptions): Promise<ConfirmationResult>;
  readonly message: Message; readonly collector: ReactionCollector; readonly ended: boolean;
  readonly finished: ReactionCollector['finished'];
  buttons: Collection<string, ReactionButtonData>; selected: ReactionInteraction | null;
  stop(reason?: string): void;
  setDisabled(id: string, disabled?: boolean): this;
  on(event: 'select', listener: (interaction: ReactionInteraction) => void | Promise<void>): this;
  on(event: 'end', listener: (collected: Collection<string, MessageReaction>, reason: string) => void | Promise<void>): this;
}
export interface ReactionPollOptions {
  question: string; choices: (string | { emoji: string; label: string })[]; time?: number; updateOnEnd?: boolean;
}
export interface PollResult { emoji: string; label: string; votes: number }
export class ReactionPoll {
  static create(channel: Channel, options: ReactionPollOptions): Promise<ReactionPoll>;
  readonly message: Message; readonly collector: ReactionCollector; readonly ended: boolean;
  readonly finished: Promise<{ results: PollResult[]; reason: string }>;
  votes: Collection<string, string>;
  results(): PollResult[];
  stop(reason?: string): void;
  on(event: 'vote' | 'voteRemove', listener: (user: User, emoji: string) => void | Promise<void>): this;
  on(event: 'end', listener: (results: PollResult[], reason: string) => void | Promise<void>): this;
}

export interface RoleCreateOptions {
  name?: string; color?: string | null; position?: number; manageServer?: boolean; manageMessages?: boolean;
}
export interface RoleEditOptions extends RoleCreateOptions {
  color2?: string | null; permissions?: Record<string, boolean>; auto?: 'none' | 'all' | 'before'; autoBefore?: Date | string | null;
}
export class Role {
  readonly client: Client; readonly guild: Guild; id: string; guildId: string; name?: string;
  color?: string | null; color2?: string | null; position?: number; manageServer?: boolean; manageMessages?: boolean;
  readonly permissions: Readonly<Record<string, boolean>>; auto: 'none' | 'all' | 'before'; autoBefore?: string | null;
  readonly members: Collection<string, GuildMember>;
  edit(options: RoleEditOptions): Promise<Role>; setName(name: string): Promise<Role>; setColor(color: string | null): Promise<Role>;
  setPermissions(permissions: Record<string, boolean>): Promise<Role>; delete(): Promise<Role>; toJSON(): Record<string, unknown>;
}
export class GuildRoleManager {
  readonly client: Client; readonly guild: Guild; readonly cache: Collection<string, Role>;
  resolve(value: string | Role): Role | null;
  fetch(): Promise<Collection<string, Role>>;
  fetch(value: string | { id: string }, options?: { force?: boolean }): Promise<Role | null>;
  create(options?: RoleCreateOptions): Promise<Role>; edit(role: string | { id: string }, options: RoleEditOptions): Promise<Role>;
  delete(role: string | { id: string }): Promise<Role>; setPositions(roles: (string | { id: string })[]): Promise<Collection<string, Role>>;
}
export class GuildMemberRoleManager {
  readonly member: GuildMember; readonly guild: Guild; readonly client: Client; readonly cache: Collection<string, Role>;
  add(role: string | { id: string }): Promise<GuildMember>; remove(role: string | { id: string }): Promise<GuildMember>;
}
export class GuildBan {
  readonly guild: Guild; readonly client: Client; id: string; guildId: string; createdTimestamp: number | null;
  readonly user: User | null; readonly createdAt: Date | null;
  remove(): Promise<void>; toJSON(): Record<string, unknown>;
}
export class GuildBanManager {
  readonly client: Client; readonly guild: Guild; cache: Collection<string, GuildBan>;
  fetch(): Promise<Collection<string, GuildBan>>; fetch(user: string | { id: string }): Promise<GuildBan | null>;
  create(user: string | { id: string }): Promise<GuildBan>; remove(user: string | { id: string }): Promise<void>;
}
export class MessageBulkDeleteError extends YapperError {
  deleted: Collection<string, Message>; failedId: string; cause: Error;
}

export class DMManager {
  readonly client: Client; readonly cache: Collection<string, Channel>;
  resolve(channel: string | Channel): Channel | null;
  create(user: string | { id: string }, options?: { force?: boolean }): Promise<Channel>;
  fetch(): Promise<Collection<string, Channel>>;
  fetch(channel: string | { id: string }): Promise<Channel | null>;
  send(user: string | { id: string }, content: string | MessageOptions): Promise<Message>;
}
