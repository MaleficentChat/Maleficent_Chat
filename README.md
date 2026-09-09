# Maleficent Chat

Maleficent Chat is a Node.js + Express + Socket.IO community chat site.

## Included

- First screen is Login / Register.
- Permanent `Maleficent` owner account.
- Default owner password: `Mal@123`.
- Main Room + additional rooms.
- Ranks: Member, VIP, Premium, Mod, Admin, Super Admin, Commissor, Coowner, Owner.
- Rank ordering and rank icons/colors.
- Online/offline presence and last-seen.
- Username mentions with notifications.
- Quote/reply, hide, report, edit, delete, reactions, pin, save/bookmark, copy and forward.
- Typing indicators, delivered/read receipts and timestamps.
- Image/audio upload and browser voice recording.
- User profiles: bio, pronouns, birthday, banner, themes, colors, profile style, badges, verification, creation date, last seen, status and privacy.
- Username change history, password management, account deletion and blocking/unblocking.
- Friends, friend requests, followers/following, profile likes and notifications.
- XP, levels, daily XP limits, XP history and leaderboards.
- Gold wallet, gifting, transaction history and owner gold editing.
- Public/private/password/rank-protected rooms, categories, descriptions, icons, banners, limits, slow mode, announcements, rules, FAQ, read-only mode, room favorites and invite links.
- Room creation/editing/deletion and `/clear` room command through the room controls.
- Moderation warning/mute/kick/ban and revoke actions, moderation history, auto-filtered words, link filtering, automatic escalation, reports and appeals.
- Staff dashboard with reports, appeals, moderation history, filter words, notes and audit logs.
- Owner Space with user/rank/password/verification/badge controls, gold controls, site settings, private-message inspection and owner audit logs.
- Advanced message search and saved-message view.
- Custom emoji upload foundation.
- Responsive desktop/tablet/mobile layout.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Render

The project includes `render.yaml`. Set a strong `SESSION_SECRET` in production. You can optionally set:

- `OWNER_USERNAME`
- `OWNER_PASSWORD`
- `OWNER_DISPLAY_NAME`

The requested defaults are `Maleficent` and `Mal@123`.

## Data

The current project keeps its lightweight application data in `data/db.json` and uploaded media in `uploads/`. For a larger production deployment, move sessions, users, messages and media to persistent services/database storage.


## Maleficent Chat V3 feature layer

This build adds a backwards-compatible feature registry for all 1000 requested feature slots, expanded account/profile settings, custom status, password change, security sessions/login history endpoints, notification preferences, user search/mute APIs, owner analytics, security headers, and a Feature Center UI. The registry is intentionally data-driven so the remaining feature implementations can be enabled incrementally without replacing the existing chat system.
