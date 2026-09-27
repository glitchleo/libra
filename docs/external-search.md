# External catalog search

## Credentials

**Tenrai and Open Library require no credentials.** Anime, manga, and book
search are available as soon as the server starts. Each catalog is configured independently;
missing TMDB or IGDB credentials do not prevent those results from loading.

Store your TMDB credentials in `server/.env` (use `server/.env.example` as the
template). `TMDB_READ_ACCESS_TOKEN` is the **API Read Access Token** from your TMDB
account's API settings. `TMDB_API_KEY` is the **v3 API key** from the same page.
Either credential is sufficient; the read token takes precedence. Paste the raw
token without the word `Bearer`. Restart the server after changing credentials.

For **IGDB**, set `IGDB_CLIENT_ID` to your Twitch application's Client ID and
`IGDB_ACCESS_TOKEN` to the `access_token` from the Twitch client-credentials grant
response. Both are required and must belong to the same application. Supply the
raw token, without `Bearer`, quotes, or the complete JSON object. Libra adds the
`Client-ID` and `Authorization: Bearer ...` headers on the Express server.
The Client Secret is used when obtaining a token from Twitch; it is not sent to IGDB
and is not needed by this adapter. `token_type` and `expires_in` are not settings.

`expires_in` measures seconds from token issuance, not from a Libra restart.
App access tokens have no refresh token: when one expires or is revoked, obtain
a new token with a POST to `https://id.twitch.tv/oauth2/token` using form parameters
`client_id`, `client_secret`, and `grant_type=client_credentials`. Replace
`IGDB_ACCESS_TOKEN` and restart Libra. Token renewal is manual in this integration;
authentication errors include recovery guidance. Do not use a Twitch user token.

Express reads these values at runtime. The browser sends requests only to Libra's
API and never receives the credentials. The provider list exposes a `configured`
boolean, which indicates that required credentials are present, not that the provider has verified
them. Authentication failures appear when a search is attempted. Real `.env` files
are ignored by Git; `.env.example` intentionally contains blank values.

## Tenrai setup

Tenrai replaces Jikan in the provider registry and selector. Public search works
immediately: run `npm run dev`, open the Search page, and choose **Tenrai**. No
Twitch token, MyAnimeList login, or Tenrai account is needed. Existing source links
still open MyAnimeList, and source IDs remain MAL IDs. There is no library data to
migrate yet; the API provider ID for new searches is now `tenrai`.

For higher throughput, optionally add `TENRAI_SERVER_KEY=your_server_key` to
`server/.env`, then restart the server. Leave it blank for public access. The key
is sent as `X-Server-Key`, never `Authorization: Bearer`, and stays on the server.
The official [Server Keys documentation](https://api.tenrai.org/llms.txt) currently
offers free temporary keys through [Tenrai's Discord](https://discord.gg/MQ3X3sjdgK).
It describes supporter keys through Patreon but also marks Patreon as not yet
available; check with Tenrai for current availability.

Public limits are **4 requests/second, 120/minute, and 40,000/day**, shared by IP.
With a server key, the documented limits are **5/second, 300/minute, and no daily
cap**, shared by key. The adapter caches searches and respects `Retry-After` on
HTTP 429. An invalid key returns setup guidance; removing it restores public mode
after a restart. A 403 can be an anti-abuse block rather than a bad key: Tenrai's
FAQ says it usually clears within 24 hours and recommends contacting support if
it persists. Service status is available at [Tenrai status](https://tenrai.org/status).

Tenrai v1 is currently beta. It provides public catalogue metadata, not account
profiles or personal anime/manga lists. Those user-data features require the
official MyAnimeList API. See the [official docs](https://api.tenrai.org/documentation)
and [FAQ](https://api.tenrai.org/faq) for details.

## Open Library setup

Choose **Open Library** in Search to find books. No API key, account, or OAuth flow
is required. For regular use, Open Library requests an application name and contact
email in the `User-Agent` header. Set `OPENLIBRARY_CONTACT_EMAIL` in `server/.env`
and restart Libra; it is sent only to Open Library, not returned to the browser.
The header is `Libra/0.1.0 (your-email)` when configured, otherwise `Libra/0.1.0`.

The documented allowance is 1 request/second without contact identification and
3/second with it. Public access works with the email field blank. This integration
performs user-triggered searches; bulk catalog imports would need the separate
data dumps described in the [API guidance](https://openlibrary.org/developers/api).

## Search behavior

- Select TMDB, Tenrai, IGDB, Open Library, or **All providers** (all four catalogs).
- **All types** searches each supported media type for the selected providers.
  Selecting a specific media type contacts only providers that support that type.
  Results stay grouped by provider and type, preserving each source's ordering,
  counts, and pagination. They are not merged or deduplicated across sources.
- Each result group loads, fails, retries, and changes page independently. A new
  title or type selection starts all active groups from page one.
- TMDB movies use `/3/search/movie`; TV series use `/3/search/tv`.
- Tenrai anime uses `/v1/anime`; manga uses `/v1/manga` with `type=manga` so novels
  and other formats are not mislabeled. Anime includes its movie/TV/OVA formats.
- Tenrai's `sfw` flag is included by default and omitted when Libra's `includeAdult`
  is enabled. It is never sent as `sfw=false`. The optional stricter `sfw-strict`
  filter is not exposed in the current UI.
- IGDB uses separate POST requests to `/v4/games` and `/v4/games/count`
  with identical search/year criteria. Each page contains up to 20 games in search
  relevance order. Page numbers map to `limit`/`offset`; totals come from the count query.
  A year filters `first_release_date` using UTC boundaries. This is the game's first
  release, not a release on a specific platform. Covers use `cover.image_id`;
  `total_rating` is scaled from 0–100 to 0–10 with `total_rating_count` as the vote count.
- IGDB has no equivalent language/adult toggle in this integration. Those controls
  are hidden for IGDB and combined searches that include games. Game results are
  not filtered by age rating. TMDB and Tenrai still exclude adult content by default.
- Tenrai has no localized-results language parameter. Its start/end-date filters
  are not equivalent to TMDB's release-year filter. Year and language are hidden
  for Tenrai and for combined searches involving Tenrai, and never sent silently
  to only some providers. English titles are preferred when Tenrai supplies them;
  otherwise the default title is used. Japanese/original titles are retained.
- Movie year maps to `primary_release_year`; TV year maps to
  `first_air_date_year`. These filter release/first-air year, respectively.
- Open Library uses `/search.json` with `title`, `page`, `limit=20`, and an explicit
  list of fields. The **First published year** filter adds `q=first_publish_year:YYYY`.
  Most records are works, with editions grouped together and stable `OL…W` source IDs.
  Search can also return legacy edition records with `OL…M` IDs, sometimes under
  a `/works/` key. Libra preserves these records and links them to `/books/OL…M`
  instead of rejecting the entire results page.
  Both documented result-count spellings (`numFound`/`num_found`) are supported.
  The first publication year is retained as a year-only `releaseDate`, without an
  invented month/day. Ratings are scaled from five stars to Libra's 0–10 scale.
- Book cards show author names instead of a synopsis: the search endpoint does
  not provide full descriptions, and Libra does not fetch each work separately.
  Covers use `cover_i` with `?default=false` so missing images trigger the existing
  fallback. This adapter does not offer edition-language or adult-content filters,
  or classify specific editions as audiobooks. Book results are not age-filtered.
- Result language requests localized metadata; it does not restrict results to
  titles originally produced in that language.
- Adult results are excluded by default for TMDB and Tenrai.
- Submit a title with Enter or Search. Year, language, and adult filters apply
  on submission. Switching media types or clearing filters reruns an existing
  query from page one. Selecting a different provider clears existing results.
- Source pagination is preserved, with accessible pages capped at 500.
- Missing posters and unrated titles have explicit fallbacks. Older responses
  are ignored when a newer search supersedes them.
- Selecting a result opens an entry details dialog on the same search screen for
  every catalog and media type. It shows all information already returned by the
  search, including the untruncated description (authors for Open Library), cover,
  original title, release/publication date, rating, and vote count. No additional
  external-catalog call is made. Book publication years retain their year-only precision.
  Back to results, the close button, Escape, and the backdrop dismiss the dialog
  without resetting the search, filters, page, or scroll position. Keyboard focus
  stays in the modal and returns to the selected card on close.
  A separate source link inside the dialog opens the original catalog in a new tab.
  **Add to library** saves the result and its selected status to local SQLite.
  Saved results show an In library badge. Status changes and reversible removal
  are available in the overlay, both from Search and Library. See [library](library.md).
- Library stores saved titles in SQLite. Add entry creates manual titles with media-specific fields; only User settings remains a placeholder.

## API

`GET /api/search/providers` returns provider IDs, labels, supported media types,
filter capabilities, website URLs, and configuration status.

`GET /api/search` accepts these query parameters:

| Parameter | Meaning |
| --- | --- |
| `provider` | Registered provider ID: `tmdb`, `tenrai`, `igdb`, or `openlibrary` |
| `query` | Nonempty title, at most 200 characters |
| `mediaType` | A media type supported by the selected provider |
| `page` | Integer 1–500; defaults to 1 |
| `year` | Optional integer 1000–9999, if supported |
| `language` | Optional locale such as `en-US`, if supported |
| `includeAdult` | Optional `true` or `false`, if supported |

Example: `/api/search?provider=tmdb&query=Dune&mediaType=movie&page=1&year=2021`.

Tenrai example: `/api/search?provider=tenrai&query=Naruto&mediaType=anime&page=1`.

IGDB example: `/api/search?provider=igdb&query=Elden%20Ring&mediaType=game&page=1&year=2022`.

Open Library example: `/api/search?provider=openlibrary&query=Dune&mediaType=book&page=1&year=1965`.

The browser coordinates combined searches by making one request per supported
provider/type pair. The API contract remains one provider/type per request;
`all` is a UI selection, not an API provider ID. This allows independent paging,
partial success, and targeted retries without manufacturing combined totals.

Tenrai requests are serialized with at least approximately 550 ms between public
request starts, or 210 ms with a server key, below each tier's per-second and
per-minute limits for this server process.
Identical in-flight requests share one call, successful searches are cached for
60 seconds (at most 100 search pages), and at most 12 searches may be outstanding.
Errors are not cached or retried automatically. A rate-limit error honors the
`Retry-After` duration or HTTP date (two seconds if missing/invalid). Queued and
new uncached requests receive a readable error during the cooldown; they do not
hold connections open for a potentially long daily reset. Multiple processes or
other apps sharing the IP/key can still exhaust the upstream allowance.

IGDB calls also use a bounded serial queue, with at least 300 ms between each HTTP
request start, including the count call (below 4 requests/second and 8 simultaneous
requests for this process). Each uncached search uses two requests. The adapter
uses the direct endpoints because live multi-query requests returned an empty
array even when the same search succeeded through `/games` and `/games/count`.
It coalesces duplicate searches, caches successful pages for 60 seconds (up to 100),
and allows at most 12 outstanding searches. Failures are not cached or retried
automatically; HTTP 429 adds a two-second cooldown. Other processes sharing the
same credentials need a shared limiter. Requests remain server-side because IGDB
does not support direct browser access. User search text is escaped as a string
inside the APICalypse body, and credentials never appear in a request URL.

Open Library serializes starts at 1,050 ms without a contact email or 350 ms with
one. Each search page makes one request with only the fields needed for the cards.
It coalesces duplicate requests, caches up to 100 pages for five minutes, and caps
pending searches at 12. HTTP 429 honors `Retry-After` (seconds or HTTP date), using
two seconds when the header is missing/invalid. Uncached requests fail promptly
during cooldown and can be retried afterwards. Errors are not cached or retried
automatically. Multiple server instances need to coordinate their shared quota.

Invalid input is rejected before external requests. Upstream calls time out after
10 seconds. Errors return a stable code and readable message without echoing
upstream bodies, credential-bearing URLs, or stack traces. Successful responses
use the normalized `CatalogSearchResponse` contract in `shared/src/types/search.ts`.

## Add a provider

1. Implement `CatalogProvider` in a new file under `server/src/providers/`.
2. Give it a stable `info.id`, public metadata, supported `mediaTypes`, and filter
   capabilities. Include an optional `setupHint` for an unconfigured provider.
3. Read any new credentials in `server/src/config/env.ts` and document blank
   variables in `server/.env.example`. Keep credentials outside public metadata.
4. Implement `search()` with upstream input mapping, timeouts, response validation,
   and normalization. Keep source IDs as strings, absent values as `null`, and
   ratings on a 0–10 scale. Use `HttpError` for safe, actionable errors.
5. Register the adapter in `createProviderRegistry([...])` in `server/src/index.ts`.
   The frontend automatically adds it to the selector and renders its supported
   media types and filters.
6. Add tests using mocked upstream responses. If a provider needs a new filter
   kind, extend the shared request/capability types, server validation, and UI.

Provider IDs are selected from a server-owned registry. A browser cannot supply
an arbitrary upstream URL. The future-provider examples in tests are fixtures
only and do not appear in the running application.

## Validation and current limits

`npm test` runs adapter/API integration tests and React interaction tests using
mocked TMDB, Tenrai, IGDB, and Open Library responses. It covers credential precedence and privacy,
metadata mapping, input validation, upstream errors, caching, request pacing,
independent pagination and retries, combined-provider searches, aborted requests,
empty results, navigation, and missing images. These automated tests make no
external requests. Real TMDB and IGDB searches require credentials; Tenrai and Open Library do not.

This implementation runs locally with a persistent SQLite library and catalog
imports. It has no user accounts or public deployment yet.

## Official references

- [Open Library API guidance and identification](https://openlibrary.org/developers/api)
- [Open Library Search API](https://openlibrary.org/dev/docs/api/search)
- [Open Library Covers API](https://openlibrary.org/dev/docs/api/covers)
- [Open Library star ratings](https://openlibrary.org/help/faq/reviews)

- [IGDB authentication and requests](https://api-docs.igdb.com/#authentication)
- [IGDB game fields](https://api-docs.igdb.com/#game)
- [IGDB count example](https://api-docs.igdb.com/#examples)
- [IGDB search and pagination](https://api-docs.igdb.com/#search-1)
- [IGDB images](https://api-docs.igdb.com/#images)
- [Twitch client-credentials grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow)
- [Twitch token expiry and renewal](https://dev.twitch.tv/docs/authentication/refresh-tokens/)

- [Tenrai v1 documentation](https://api.tenrai.org/documentation)
- [Tenrai machine-readable documentation, auth, limits, and server keys](https://api.tenrai.org/llms.txt)
- [Tenrai FAQ](https://api.tenrai.org/faq)

- [Application authentication](https://developer.themoviedb.org/docs/authentication-application)
- [Movie search](https://developer.themoviedb.org/reference/search-movie)
- [TV search](https://developer.themoviedb.org/reference/search-tv)
- [Image URLs](https://developer.themoviedb.org/docs/image-basics)
- [Attribution requirements](https://developer.themoviedb.org/docs/faq)
- [Approved TMDB logos](https://www.themoviedb.org/about/logos-attribution)

The application's Data & credits section includes TMDB's attribution notice and
an approved logo linked from its official branding page, plus credit to Tenrai
and its relationship to MyAnimeList, and linked credits for IGDB and Open Library.
