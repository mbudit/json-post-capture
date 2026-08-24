# json-post-capture

A small HTTP server that catches JSON POSTs from an automatic weather
station data logger and stores them for viewing.

## How it works

1. Run this app. It listens for HTTP POST requests on `/api/capture`.
2. On your data logger, configure the destination URL to point at this
   machine, e.g. `http://<this-machine-ip>:3000/api/capture`.
3. Every time the logger POSTs, the raw body is saved to a local SQLite
   database (`data/captures.db`) along with the timestamp, source IP,
   and content type.
4. Open the dashboard in a browser to see captures come in live.

The capture endpoint accepts any body — valid JSON is parsed and
pretty-printed in the dashboard; anything that isn't valid JSON is still
stored as raw text so nothing gets lost while you're debugging the
logger's output format.

## Run it

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000) for the
dashboard.

## Deploy with Docker

On a server with Docker Compose installed, copy the project to the server
and run:

```bash
docker compose up -d --build
```

The service is configured to restart automatically after crashes or server
reboots. SQLite data is persisted in the Docker volume `captures-data`. View
the dashboard at `http://<server-ip>:3000` and configure the logger to post to
`http://<server-ip>:3000/api/capture`.

To protect the dashboard and API, set an API key before starting the service:

```bash
export CAPTURE_API_KEY='replace-with-a-long-random-value'
docker compose up -d --build
```

If port 3000 is already in use, choose another host port without changing the
container port:

```bash
PORT=8080 docker compose up -d --build
```

Useful commands:

```bash
docker compose logs -f
docker compose ps
docker compose down
```

By default the server listens on all network interfaces (`0.0.0.0`) so
devices on your LAN — like the data logger — can reach it. Find this
machine's LAN IP with:

```bash
ipconfig
```

(look for the "IPv4 Address" under your active network adapter).

## Configuring the data logger

Point the logger's HTTP POST destination at:

```
http://<this-machine-ip>:3000/api/capture
```

If you run multiple stations and want to tell them apart even when
their payloads don't include a station name, POST to a per-station path
instead:

```
http://<this-machine-ip>:3000/api/capture/<station-name>
```

If the logger's payload already includes one of these fields, the
station name is picked up automatically: `station`, `station_name`,
`station_id`, `logger`, `site`, `name`.

## Forwarding (passthrough)

Every capture can be passed through to another HTTP endpoint — useful when a
second system needs the same data the logger is sending here. Open the
**Forwarding** panel on the dashboard, set the target host/IP, port and path,
tick *Enable forwarding*, and press **Save**. **Send test POST** delivers a
small sample payload so you can confirm the target is reachable before
switching it on.

The settings are stored in the database, so they survive restarts and can be
changed at any time without redeploying.

How it behaves:

- The capture is stored and the logger gets its `200` **first**; forwarding
  happens afterwards. A slow or unreachable target never delays or fails the
  logger's POST.
- The body is passed through byte-for-byte with the original `Content-Type`,
  including bodies that aren't valid JSON.
- Failed forwards are logged and shown on the dashboard ("Last forward at …"),
  but are **not** retried. The payload is still in the database, so nothing is
  lost — it just isn't re-delivered automatically.
- Plain HTTP only; there's no HTTPS target support.

## Configuration (environment variables)

| Variable          | Default        | Purpose                                      |
|--------------------|----------------|-----------------------------------------------|
| `PORT`             | `3000`         | Port to listen on                             |
| `HOST`             | `0.0.0.0`      | Network interface to bind                     |
| `DB_PATH`          | `data/captures.db` | Path to the SQLite database file         |
| `CAPTURE_API_KEY`  | (unset)        | If set, requires `x-api-key` header or `?apikey=` on every request |

## API

- `POST /api/capture` — accepts any body, stores it, responds `200 {"status":"ok","id":N}`.
- `POST /api/capture/:station` — same, tagged with a station name.
- `GET /api/captures?page=1&limit=100` — list captures (most recent first), with pagination metadata.
- `GET /api/captures/:id` — full detail of one capture, including headers.
- `DELETE /api/captures/:id` — delete a capture.
- `GET /api/forward` — current forwarding config plus the last attempt's result.
- `PUT /api/forward` — update the config, e.g. `{"enabled":true,"host":"192.168.1.50","port":8080,"path":"/ingest","timeout_ms":5000}`.
- `POST /api/forward/test` — send a test payload to the configured target and return the result.

## Notes

- Storage uses Node's built-in `node:sqlite` module — no native build
  tools required, which matters on Windows.
- If your data logger and this machine aren't on the same network
  (e.g. the logger posts over the public internet), you'll need to
  either port-forward this machine's `PORT` on your router or run this
  app on a server with a public IP/domain — the app itself doesn't
  change either way.
