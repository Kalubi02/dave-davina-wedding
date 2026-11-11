# Davina & David wedding site

Node/Express + static frontend. Data (RSVPs, song requests, quiz scores) lives in `data/db.json` (or `$DATA_DIR/db.json`).

## Run locally
    npm install
    cp .env.example .env   # set ADMIN_PASSWORD (+ Spotify keys if you have them)
    npm start              # http://localhost:4826

## Edit content
- Quiz questions/answers: `config/quiz.json` (`answer` = index of the correct option, 0 = first). No restart needed.
- Venmo / Zelle / Stripe link / QR images / wedding time: `config/site.json`. Put QR images in `public/img/` and set e.g. `"venmoQr": "/img/venmo-qr.png"`.
- Story text, times, hotel, dress code: `public/index.html` (search for "placeholder" / "to be announced").

## Song search
Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` (create an app at developer.spotify.com, Client Credentials flow). Without them, the site falls back to the free iTunes Search API.

## Admin
`/admin` (HTTP Basic auth, any username, password = `ADMIN_PASSWORD`). CSV export at `/admin/rsvps.csv`.

## Tests + screenshots
    node scripts/test-and-screenshot.js   # needs the server running; writes ../screenshots/
