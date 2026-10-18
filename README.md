# Radio Radicale API and web player

An unofficial, read-only wrapper around [Radio Radicale](https://www.radioradicale.it). It fetches public archive pages, extracts search results and recording metadata, exposes them as JSON, and serves a browser player for archived HLS recordings and the live MP3 stream. The server uses Node.js built-ins and has no npm runtime dependencies. The browser loads Plyr and Hls.js from a CDN.

This repository is a dependency-free rebuild of the API and player described below. The API and UI are implemented in `src/`; `npm test` runs offline parser and handler tests. Radio Radicale is an external data source, so its HTML structure, embedded settings, media URLs, and playback permissions can change independently of this project. Live scraping and playback should be checked against the upstream site before deployment.

## Run it

Use Node.js 22 for parity with the Docker image. The code needs at least Node.js 18 for global `fetch`.

```bash
npm start
# Open http://localhost:3000/ for the player or /docs for API examples.
```

During development, use `npm run dev` to restart the Node process when parser or route modules change. If you are already running `npm start`, restart it after changing server files; refresh the browser to load UI changes.

There is no install step or database. Configuration comes from environment variables:

| Variable | Current default | Purpose |
| --- | ---: | --- |
| `PORT` | `3000` | HTTP listen port |
| `CACHE_TTL_SECONDS` | `300` | Lifetime of cached search and recording responses |
| `CACHE_MAX_ITEMS` | `500` | Maximum entries in the in-memory API cache |
| `NODE_ENV` | unset locally, `production` in Docker | `test` suppresses direct server startup; otherwise it has no application behavior |

Zero and invalid values fall back to the defaults. The API cache is per process and disappears on restart. Static UI files have a separate in-memory cache limited to 24 items that reloads a file when its modification time changes.

Docker Compose builds the Node 22 Alpine image, publishes `${PORT:-3000}` on the host to port 3000 in the container, mounts `./src` read-only at `/app/src`, and configures a `/health` check:

```bash
docker compose up --build -d
docker compose ps
docker compose down
```

The source mount makes file changes visible to the running container; there is no Node process watcher, so changes to already loaded server modules still require a restart. The Dockerfile itself also has a health check and runs as the `node` user.

## What a user can do

1. Search the full archive by keyword, across all categories with no date restriction, or browse a subject/speaker listing. Results show title, media type, date, category, location, and duration; the API also returns an optional thumbnail. The app displays every result returned for each upstream page and imposes no ten-result or ten-page cap. Use previous/next or enter a page number to browse the rest of the search. Page changes return to the result heading without interrupting playback. Browser URLs use one-based pages (`/?q=giustizia&page=2`); the API uses zero-based page numbers (`/api/search?q=giustizia&page=1`). Subject listings can be restored with `/?subject=86%2Fmarco-pannella&page=2`. Opening a recording retains the search and page in the URL.
2. Select a search result to open its recording and start the first track. If the browser blocks playback after the recording loads, press Play in the player. You can also enter a numeric ID or URL, or load `/?id=12345` or `/?url=...`. The app shows metadata, topics, tracks, and speaker interventions when available.
3. Play an HLS track in the page. Hls.js handles browsers with Media Source Extensions; browsers with native HLS support use the media element. Plyr supplies playback controls. Tracks have numbered labels such as `Audio 1`, `Audio 2`, and `Audio 3` in the menu, player header, and intervention list. Clicking an intervention in another track loads that track, seeks to the intervention once metadata is available, and starts playback. Selecting a track in the menu also starts it. When a track ends, playback continues with the next track. The app shows the current or next speaker in a dedicated box, intervention ticks on the playbar, track subtitles, and links to copy a media URL or open the source page/JSON. Speakers listed at the same moment appear together in the box. Markers appear when the track duration is known.
4. Listen to the live MP3 stream. A mobile layout switches between search and player tabs and keeps a compact player with play/pause controls visible over the search view.
5. Filter the intervention list by name, role, or track label (for example `avvocato Audio 2`). The filter ignores accents and letter case and leaves playback running. Skip backward or forward by 15 seconds without changing whether the player is paused, and choose a playback speed from 0.75× to 2×. The chosen speed carries over when switching tracks.
6. Seek using a full-width progress row with a 48px touch area and a square 20px audio handle. Dragging previews the target time and speaker, alongside the remaining time. Intervention ticks do not intercept touches; scrollable buttons below the bar show each intervention's time and name and jump to its start. Enter minutes and seconds to seek precisely while preserving whether playback is paused. The exact seek controls wait for the actual media duration and reject invalid times or points beyond the end of the track. Keyboard seeking uses five-second steps.
7. Switch between light and dark themes using the control in the sticky header, including while scrolling, searching, listening, or reading the API documentation. The first visit follows the device's preference; a manual selection is saved in local storage and takes priority on future visits. Changes sync across tabs. The switch also works for the current visit when storage is blocked and does not reload or interrupt the player.
8. Share the loaded recording with `condividi` or `copia link`. On supported phones, sharing opens the native share sheet; other browsers copy the link or show a selectable URL if clipboard access is blocked. Links use the current site's origin and include the selected track with a one-based `track` parameter. Check `dal punto attuale` to add the current position as `t` in seconds: `/?id=586796&track=2&t=95` opens Audio 2 at 1:35, paused and ready to play. Invalid track indexes fall back to the first track, and timestamps beyond the track's duration are clamped to its end. Live-stream links use `/?live=1`. The existing `copia link media` action still copies the direct stream URL.

The interface follows a Craigslist-inspired visual system: neutral backgrounds, gray section bars and dividers, blue text links, purple navigation, serif headings, and compact text listings. Light and dark color tokens are defined at the top of `src/ui/styles.css`. `src/ui/theme.js` applies the saved or device theme before styles load, independently of the playback scripts. Below 700px, search and playback use separate tabs beneath the sticky header, and the compact player stays above the phone's safe area. Form inputs use at least 16px text and primary buttons use 44px touch targets. Audio controls sit directly below the recording title without a decorative poster.

The page is served at `/`, `/app`, `/player`, and `/player.html`. Static assets are under `/ui/`; human-readable endpoint examples are at `/docs` and `/api-docs`. On startup, `?live=1` opens the live stream, `?id=` or `?url=` opens a recording, and `?q=` starts a search. With none of those parameters, the UI searches for `giustizia`. The UI has no build step. It loads Plyr 3.7.8 and Hls.js 1.5.8 from CDNs and retains native media controls if those scripts are unavailable.

## API contract

The server accepts `GET`, `HEAD`, and `OPTIONS`. Other methods return JSON with HTTP 405. `OPTIONS` returns 204. Responses include `Access-Control-Allow-Origin: *`; JSON, HTML, CSS, and JS bodies larger than 1 KiB are gzip compressed when the request advertises gzip. Unknown paths return JSON 404 with a `/docs` pointer. Errors caught by the request handler return `{ "error": "...", "statusCode": 500 }` or the `status` attached to the error. There is no authentication or rate limit.

| Route | Inputs | Current response |
| --- | --- | --- |
| `GET /health`, `/api/health` | none | Status, timestamp, uptime, RSS/heap MB, and API cache entry count. This checks the process, not the upstream site. |
| `GET /api/live` | none | Static title, `streamUrl`, `format`, `website`, and `status: "online"`. It does not probe the stream. |
| `GET /api/live/stream` | none | 302 redirect to `https://live.radioradicale.it/live.mp3`. |
| `GET /api/search`, `/api/cerca` | `q` (or `query`) required; `page=0`; `type=general` or `soggetti` | Search metadata, result cards, pagination, and related links. Missing query returns 400. |
| `GET /api/soggetti/:slug` | path can contain e.g. `86/marco-pannella`; `page=0` | Same search response shape for a subject/speaker listing. |
| `GET /api/scheda/:id`, `/api/scheda?id=:id`, `/api/scheda?url=:url` | Recording ID or page URL | Recording metadata, tracks, subtitles, and speaker offsets. Missing ID/URL returns 400. |
| `GET /api/m3u8/:id`, `/api/stream/:id` | `track=0`; `redirect=false` for JSON | 302 to the selected HLS URL by default; JSON when `redirect=false` or `Accept` includes `application/json`; 404 if no HLS source is found. |

Examples:

```bash
curl 'http://localhost:3000/api/search?q=giustizia&page=0'
curl 'http://localhost:3000/api/soggetti/86/marco-pannella?page=0'
curl 'http://localhost:3000/api/scheda/163473'
curl 'http://localhost:3000/api/m3u8/163473?track=0&redirect=false'
curl -I 'http://localhost:3000/api/live/stream'
```

The key response shapes are:

```json
{
  "query": "giustizia",
  "type": "general",
  "searchUrl": "https://www.radioradicale.it/cerca?...",
  "finalUrl": "https://www.radioradicale.it/cerca?...",
  "results": [{
    "id": "12345", "title": "...", "href": "/scheda/12345/...",
    "url": "https://www.radioradicale.it/scheda/12345/...",
    "mediaType": "audio", "date": "...", "dateIso": "...",
    "category": "...", "location": "...", "duration": "...", "thumbnail": null
  }],
  "count": 1,
  "pagination": { "currentPage": 0, "totalPages": 1, "totalPagesKnown": true, "hasNext": false, "hasPrev": false },
  "related": [{ "href": "/soggetti/...", "url": "https://www.radioradicale.it/soggetti/...", "text": "..." }]
}
```

```json
{
  "id": "12345", "title": "...", "date": null, "category": null,
  "location": null, "duration": null, "curator": null, "summary": null,
  "topics": [], "poster": null, "hasTranscript": false,
  "transcriptUrls": [], "canonicalUrl": "https://www.radioradicale.it/scheda/12345",
  "shortUrl": "https://www.radioradicale.it/scheda/12345",
  "tracks": [{
    "index": 0, "title": "...", "m3u8": "https://.../playlist.m3u8",
    "audio": true, "sources": [], "subtitles": []
  }],
  "speakers": [{
    "id": "1", "name": "...", "role": null, "offset": 0,
    "durationSeconds": null, "fileIndex": 0
  }],
  "primaryM3u8": "https://.../playlist.m3u8"
}
```

These are shape examples, not a promise that any particular upstream recording has every field. Missing fields are often `null`, empty strings, or empty arrays. `count` is the number of items parsed on the current page, not a global total. The stream JSON contains `id`, `title`, `trackIndex`, `m3u8`, `audio`, and `subtitles`.

Search and recording detail responses use the process cache and expose `X-Cache: MISS` or `HIT`. The cache stores successful parsed responses for the configured TTL, refreshes access order on a hit, and evicts the oldest entry when full. Stream and detail routes share recording cache entries. Live metadata and health responses do not use this cache.

## How the data moves

```text
Browser search -> /api/search -> Radio Radicale /cerca or /soggetti -> HTML parser -> JSON
Browser selects a result -> /api/scheda -> Radio Radicale /scheda/:id -> HTML + Drupal.settings -> JSON
Browser player -> HLS URL from JSON -> upstream media host
Live button -> upstream live.mp3 (the API also offers /api/live/stream as a redirect)
```

The API does **not** host, download, or proxy media. It returns external media URLs or redirects to them. HLS playback therefore depends on the upstream manifest and segment hosts, browser CORS behavior, and their continued availability.

For general search, construct `https://www.radioradicale.it/cerca?search_api_views_fulltext=<encoded query>&raggruppamenti_radio=All&field_data_1%5Bdate%5D=&field_data_2%5Bdate%5D=` and add `page` when above zero. All categories and both empty date fields are preserved on every requested page; full-archive responses use a separate cache scope from the previous category-filtered search. Subject mode constructs `/soggetti/<slug>` and optionally `?page=<number>`. The search parser scans `li.clearfix` elements containing `/scheda/<numeric id>`, deduplicates IDs, extracts displayed fields, reads pager links to estimate total pages, and finds related terms.

Pager URLs are decoded before their page parameters are read, including HTML-escaped ampersands. `totalPagesKnown` distinguishes a confirmed total from the highest page observed in a pager window. The UI shows a total and limits page jumps only when that total is confirmed. If a nonempty page contains no recognizable pager, the next-page control remains available; an empty response ends forward navigation. This fallback can produce one empty page after the last result. Each requested page has its own API cache entry.

For recording detail, fetch `/scheda/<id>` or an approved recording URL. The extractor searches the HTML for a `Drupal.settings, {...});` payload, parses JSON, and reads `RRscheda.playlist`. Each playlist item becomes a track with a media source URL as `m3u8`. It also reads embedded recording ID, date, location, image, transcript references, canonical/short links, and intervention offsets. HTML extraction supplies title, category, duration, curator, summary, topics, and speakers; a JSON-LD thumbnail is a fallback. If upstream markup changes, fields can be missing or parsing can fail. Representative offline fixtures are in `test/api.test.js`.

The browser receives API JSON, renders search cards and recording detail, and loads the selected track into an `<audio>` or `<video>` element. A track's `audio` flag determines which player is used. Speaker entries use `fileIndex`, `offset`, and optionally `durationSeconds` for seeking, the current-speaker box, and Plyr progress markers. The API also includes the speaker's role or relationship text when present in the source page, such as `avvocato di …`, and the intervention list displays it below the name. The browser attaches subtitle entries from each track's `subtitles` array; `transcriptUrls` are returned by the API but are not separately attached by the current UI.

Each media element keeps its Plyr instance across source changes so native playback listeners stay attached. Changing tracks destroys the previous Hls.js stream, cancels its pending seek and playback request, and creates a session for the new source. Late events from an earlier Hls.js instance are ignored. Native HLS sources explicitly load metadata before a pending intervention seek is applied.

## Code map and rebuild order

| Path | Responsibility |
| --- | --- |
| `src/config/index.js` | Environment defaults, upstream URLs, browser-like upstream user agent. |
| `src/core/utils.js` | Text cleanup, upstream `fetch`, JSON/HTML response helpers, optional gzip. |
| `src/core/cache.js` | `Map`-based TTL cache with access-order LRU eviction. |
| `src/services/search.js` | Search URL builder and HTML result/pagination parser. |
| `src/services/extractor.js` | Recording page fetch and metadata/media extraction. |
| `src/services/live.js` | Static live stream information. |
| `src/routes/api.js` | Parameter handling, API cache lookup, response shapes, stream redirects. |
| `src/routes/static.js` | UI file serving, MIME types, modification-time cache. |
| `src/routes/docs.js` | Server-rendered API documentation page. |
| `src/server.js` | HTTP server, request dispatch, method handling, error boundary, shutdown. |
| `src/ui/index.html`, `styles.css`, `app.js`, `speaker-timeline.js` | Browser markup, responsive styles, search/player state, and speaker timeline. |
| `src/cache.js`, `src/extractor.js` | Re-exports for older imports and tests. |
| `test/api.test.js` | Native Node test suite for helpers, sample search HTML, static UI, and basic HTTP routes. |

The server keeps data extraction separate from HTTP routing so parser fixtures can be tested without live network access. The UI works on mobile and desktop and exposes HLS tracks and the live stream without proxying media.

## Further improvements

The rebuild validates recording URLs and indexes, limits upstream request time and body size, bounds both caches, and renders upstream text with DOM text nodes. Follow-up work should focus on:

1. **Current upstream compatibility.** Capture representative search and recording HTML from Radio Radicale and expand fixtures for changed and missing fields. The current fixtures are intentionally small and do not establish live compatibility.
2. **Traffic limits.** Add a concurrency or request-rate limit if this API will be exposed publicly. Review the permissive `*` CORS policy for that deployment.
3. **Browser verification.** Test playback, subtitle attachment, speaker seeking, and hostile upstream text in real mobile and desktop browsers with network access.
4. **Deployment details.** Pin and review the browser CDN assets or serve local copies; add a project license if one is intended. `/api/live` reports `online` as static metadata, not as a stream probe.

## Verification

Run `npm test`. It uses `node:test`, recorded HTML fixtures, and direct request-handler tests, so it does not require network access or a TCP listener. These tests do not prove that Radio Radicale's current pages or streams still match the scraper. Validate live scraping and media playback separately in an environment with external network and browser access.

This project is unofficial. Radio Radicale retains ownership and control of its site and media; review its terms before deploying or redistributing a service built on this code. No project license has been granted in this repository.
