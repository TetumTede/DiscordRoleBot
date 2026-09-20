# Discord Role Button Bot

Post a panel of buttons in a channel; clicking a button gives a member the
linked role, clicking it again removes it. Panels can hold as many roles as
you like — once a page fills up, the bot chains a new linked page
automatically — and anyone can check which of a panel's roles they already
have via a "Check My Roles" button, which shows a private, color-coded view
(green = have it, grey = don't) that updates live as they click.

## Setup

1. Create an application at https://discord.com/developers/applications and
   add a **Bot** to it.
2. On the OAuth2 → URL Generator page, check these scopes and permissions,
   then use the generated URL to invite the bot to your server:
   - **Scopes:** `bot`, `applications.commands`
   - **Bot Permissions:** View Channels, Send Messages, Embed Links,
     Read Message History, Manage Roles
   - Make sure to click all the way through to **Authorize** — if the bot
     doesn't show up in your server's member list afterward, the invite
     didn't finish and none of this will work.
3. In Server Settings → Roles, drag the bot's role **above** every role you
   want it to be able to assign (Discord won't let a bot manage a role
   positioned above its own).
4. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_TOKEN` — Bot → Reset Token, on your application's page
   - `CLIENT_ID` — General Information → Application ID
   - `GUILD_ID` *(optional)* — your server's ID, for instant command
     registration while testing (global registration can take up to an hour
     to propagate)

   Never commit `.env` or paste real values into `.env.example` — only `.env`
   is git-ignored.
5. Install dependencies and register the slash commands:
   ```
   npm install
   npm run deploy
   ```
6. Start the bot:
   ```
   npm start
   ```
   Re-run `npm run deploy` any time a command's options change; a plain code
   change just needs `npm start` again.

## Commands

`/rolepanel` requires the **Manage Roles** permission *and* a highest role
positioned above the bot's own highest role (the server owner is always
exempt from the second check). `/myroles` and the panel's buttons are open to
everyone.

- **`/rolepanel create title:<text> description:<text>`** — posts a new panel
  message and replies with its message ID.
- **`/rolepanel add-role message_id:<id> role:<@role> label:<text> emoji:<emoji> style:<Primary|Secondary|Success|Danger>`** —
  adds a button for that role to the panel (run once per role). Once a page
  fills up (20 role buttons — the 5th row on every page is reserved for
  "Check My Roles"), the bot automatically starts a new linked page — keep
  passing the *original* message ID from `create` and it follows the chain
  for you.
- **`/rolepanel remove-role message_id:<id> role:<@role>`** — removes a
  role's button, searching every page of the panel.
- **`/rolepanel edit-role message_id:<id> role:<@role> label:<text> emoji:<emoji> style:<Primary|Secondary|Success|Danger>`** —
  changes a role button's label, emoji, and/or color in place, without
  moving it or requiring you to remove and re-add it. Leave a field out to
  keep it as-is.
- **`/rolepanel move-role message_id:<id> role:<@role> position:<n>`** —
  reorders a role's button to position `n` (1 = first) among all of the
  panel's role buttons, repacking every page in the new order. Out-of-range
  positions are clamped to the nearest end.
- **`/rolepanel edit message_id:<id> title:<text> description:<text>`** —
  updates the panel's title and/or description (leave either blank to keep
  it as-is); applies across every page of the panel. Buttons are untouched.
- **`/myroles message_id:<id>`** — replies privately with the panel's roles
  as buttons, colored by whether you already have each one; clicking toggles
  the role and recolors instantly. The same view opens automatically from the
  **🔍 Check My Roles** button seeded onto every panel page.

## How it works (no database)

Each button's `customId` encodes the role ID directly, so toggling needs no
stored mapping and survives restarts. Panels that span multiple messages
track their page order via a small marker in each embed's footer (e.g.
`Page 1 • next:123456789`) rather than external state.

## Project layout

- `index.js` — logs in, loads commands, handles all button interactions
- `lib/panel.js` — shared helpers: page chaining, message/channel lookups,
  button rebuilding
- `commands/rolepanel.js` — `/rolepanel` (create / add-role / remove-role /
  edit-role / move-role / edit)
- `commands/myroles.js` — `/myroles` and the personalized panel builder
  reused by the panel's button
- `deploy-commands.js` — registers slash commands with Discord
