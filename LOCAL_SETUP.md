# Local web app
- Install dependencies: `npm install`.
- Put your Telegram bot token into a `.env` file as `TELEGRAM_BOT_TOKEN=<token>` (or export it in the shell) if you plan to use Telegram login.
- Start the server: `npm start` (default port is 3000, override with `PORT=4000`).
- Open `http://localhost:3000` in a browser — Express serves the SPA with a fallback to `index.html`.
- Set a TMDB key once in the browser console if you want your own quota: `localStorage.setItem("movieapp_tmdb_key", "<tmdb_api_key>");`.
