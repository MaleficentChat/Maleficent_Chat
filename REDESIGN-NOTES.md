# Maleficent Chat — Reference UI Redesign

This build refreshes the front-end visual design to closely follow the supplied reference screenshots while keeping the existing Maleficent Chat backend/API structure intact.

## Visual changes
- Slim left navigation rail with compact icon-first navigation.
- Fixed top header with brand, private-message, friends, notification, report and profile controls.
- Dark blue/charcoal chat workspace with subtle doodle-style background texture.
- Large central room chat area with compact message styling and hover actions.
- Dedicated right-side online-user panel with tab-like header and online count badge.
- Room switching from the chat header so the room list does not permanently consume chat space.
- Richer profile popup inspired by the supplied profile screenshots.
- Updated inputs, buttons, cards, modals, scrollbars and responsive/mobile behavior.
- Existing IDs and API calls were retained wherever possible so the redesign remains a presentation-layer change rather than a backend rewrite.

## Validation
- `node --check public/app.js`
- `node --check server.js`

Install dependencies normally with `npm install`, then start with `npm start` or your existing Render deployment configuration.
