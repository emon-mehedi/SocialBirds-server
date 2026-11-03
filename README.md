# SocialBirds Server

Express + MongoDB API for the SocialBirds client.

## Run

```bash
npm install
npm start
```

Copy `.env.example` to `.env` first. On Vercel, add the same three variables in **Project → Settings → Environment Variables** (`AUTH_URL` must be the live client URL, e.g. `https://socialbirds-client-l.vercel.app`).

## API

| Method | Route | Login needed | What it does |
| --- | --- | --- | --- |
| GET | `/events?limit=6` | no | Upcoming events, nearest date first |
| GET | `/events/:id` | no | One event + participant count |
| POST | `/events` | yes | Create an event (future date only) |
| PATCH | `/events/:id` | yes (owner) | Update an event |
| DELETE | `/events/:id` | yes (owner) | Delete an event |
| GET | `/myEvents` | yes | Events created by me |
| GET | `/joinedEvents` | yes | Events I joined, sorted by date |
| GET | `/joinedEvents/check/:eventId` | yes | Did I join this event? |
| POST | `/joinedEvents` | yes | Join an event |
| DELETE | `/joinedEvents/:eventId` | yes | Leave an event |

"Login needed" routes check the JWT that BetterAuth creates on the client app.
