# LOOPR — getting the app running

Runs today, but it needs a Supabase project and two environment variables before
anything shows on screen. There is no mock mode: every screen reads from the
real database, because a fake ELO number is worse than no number when you are
showing it to clubs and investors.

## 1. Create the Supabase project

1. Sign up at https://supabase.com and create a project (the free tier is fine
   for the Klang Valley pilot).
2. Open **SQL Editor** and run these files **in order**:
   - `supabase/1-tables.sql`
   - `supabase/2-ratings.sql`
   - `supabase/3-functions.sql`
   - `supabase/4-tournaments.sql`

   They are split because the SQL editor truncates long input, and ordered
   because later files depend on earlier ones. All four are idempotent, so
   re-running is safe.
3. Go to **Project Settings → API** and copy two values.

> These four files have been checked for balanced function bodies but have
> **not** been executed against a live database — no Postgres was available in
> the build environment. Run them once against a throwaway project before you
> rely on them.

## 2. Environment variables

Create `.env` next to `package.json` (copy `.env.example`):

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Restart the dev server afterwards; Expo reads these at startup only.

`.env` is gitignored. Only the anon key ever reaches a device, and row level
security is what protects the data — not the key. Never put `service_role` here.

## 3. Magic-link sign-in

In Supabase **Authentication → URL Configuration**:

- Site URL: `http://localhost:8081`
- Redirect URL: `loopr://auth`

On a device over Expo Go, use your computer's LAN address
(`http://192.168.1.5:8081`) instead of `localhost`.

## 4. Bootstrap the first admin

There is no way to promote the first admin from inside the app — with zero admins
nobody can grant anything, and making that self-service would mean anyone could
make themselves one. Seed exactly one admin via SQL, then never again:

```sql
-- find your user id
select id, handle, display_name from public.profiles where handle = 'your-handle';

-- promote yourself (run once)
insert into public.staff (user_id, role, organisation, granted_by)
values ('<your-uuid>', 'admin', 'LOOPR', '<your-uuid>');
```

After that, every promotion happens in-app: the admin generates a one-time code,
the new organiser redeems it on the Account tab.

## 5. Run it

```bash
npm start
npm test          # 31 assertions over the rating, score and match-state rules
npm run typecheck
```

Testing verification needs two accounts — you cannot confirm your own result.
Sign in on a second device or simulator.

## What is built

| Route | What it does |
| --- | --- |
| `partners` | Find players near your level with a compatible setup and free time |
| `index` | Profile, setup, and both ELO ratings side by side |
| `log-match` | Submit a result; the opponent must confirm it first |
| `confirm` | Approve or dispute results claimed against you |
| `history` | All results with their status and the rating each one produced |
| `admin` | Tournaments, result entry, disputes, and role management |
| `auth` | Magic-link sign-in, sign-out, and invite-code redemption |

## How a casual result works

```
Player A submits  ──▶  status: pending      no rating has moved
Player B confirms ──▶  status: confirmed    ELO applied to both
Player B disputes ──▶  status: disputed     ELO still untouched, admin reviews
```

**Ratings move at confirmation, never at submission.** If they moved at
submission, a rejected claim would need unwinding, and a match the opponent never
saw would already have changed two profiles for no reason. Because a pending
match never touched a rating, disputing it is genuinely free — there is nothing
to reverse.

Only the opponent can confirm. An admin can override, but only after a dispute
has been filed, so verification cannot be bypassed quietly.

## How sanctioned ELO works

An organiser creates a tournament, enters the players, then records who played
whom and the score. **No organiser ever types a rating.** The database computes
it at K=24.

### Scored against the seed, not the average

Each result is scored against **the strongest entrant other than the two players
involved** — the tournament's seed standard.

This was not the first design. Rating against the *average of the whole field* was
wrong in a way that matters: at a club event where your only games are against
two beginners, you'd climb toward the standard of the open champion you never
faced. Players would rise without ever beating anyone stronger than themselves.

Scoring against the seed means:

- the top seed is measured against the second seed they actually faced
- a weak entrant who wins a round gains little, because the reference is strong
- seed order therefore decides what a win is worth, so the organiser screen says
  so plainly

Entrants are snapshotted at the moment they are entered. If strength were looked
up later, matches played *during* the event would silently rewrite the tournament's
baseline.

There is no draw in table tennis and the app has no concept of one. What it has
instead is entrant list plus seed order, which is what actually determines the
standard a player is measured against.

Sanctioned ELO deliberately does **not** reuse the casual algorithm. Casual
carries provisional drift toward the mean, a discount for unproven opponents, and
per-tag weights; none of that applies to a tournament result, where both players
are established.

The two ratings never mix. If a 40-year-old veteran lost a training game to a
beginner, only their casual number should move.

## Anti-farming

Plain ELO is trivially inflated by two accounts trading wins. Every casual result
is discounted by how much it actually proves:

- a *training* drill moves the rating half as much as a league match
- beating someone with no history moves it half as much again
- rematches decay: the fifth meeting counts a tenth
- new players drift back toward 1500 until they have 8 confirmed matches

An opponent-provisional discount alone does **not** stop farming — two accounts
that both sit near 1500 never trigger it. Rematch decay is what actually
saturates the pattern. Verified in `src/lib/elo.test.ts`.

## Decisions worth knowing

**Ratings are computed in Postgres, never by the client.** An early draft had the
app send its own post-match rating, which let a patched build set itself to 3000.
Since matching ranks by rating, that compromised the product. Every rating change
is a `SECURITY DEFINER` function that locks both rows in a deterministic order.

**Column privileges, not just RLS.** RLS says *who* may write a row; the grants in
`1-tables.sql` say *what*. Without them, `profiles_update_self` would let any
player write every column of their own profile, both rating columns included.
Typing the field out of `db.ts` does not help — the REST endpoint is directly
callable.

**Roles live outside `profiles`** for the same reason: a role column would be
writable by anyone who can update their own profile row.

**The ELO constants exist twice** — `supabase/2-ratings.sql` and
`src/lib/elo.ts`. The database is authoritative; the TypeScript copy exists so the
test suite can exercise the algorithm without a live database. Change one, change
the other.

## Getting an APK for testers

There is no APK in the repo on purpose — binaries do not belong in git. Build one
with EAS Build, which compiles in the cloud, so no Android Studio or Xcode is
needed.

**One-time setup:**

```bash
npm install -g eas-cli
eas login
eas build:configure        # writes build IDs into app.json
```

**Android APK** — this is the one you want. `apk` installs on any device with
"unknown sources" enabled, no Play Store needed:

```bash
eas build --platform android --profile preview
```

That prints a QR code and a download link. Anyone with the link can install it.

**iOS** — needs a paid Apple Developer account. Builds are signed, so each
tester's device UDID must be registered. Use EAS internal distribution, which
handles the Ad Hoc certificates for you, then share the link it gives you.

**Sharing with testers:** send them the link from EAS, or run
`eas build:run -p android --latest` to install straight onto a connected device.

**Important:** a `preview` build bakes your `EXPO_PUBLIC_*` values into the
binary at build time. Rebuild the APK whenever you change them, or the app will
keep using the old ones. `.env` is gitignored, so a fresh clone has no keys and
will render nothing until you add them.

**Expo Go cannot run this app.** It uses native tabs
(`expo-router/unstable-native-tabs`), which is a native module, so it needs a
development build rather than the Expo Go client.

For iterating with live reload during development, use a development build
(`npx expo install expo-dev-client`, then `eas build --profile development`) and
run `npx expo start`. That is a separate install from the preview APK — keep the
preview APK for testers and the dev build for yourself.

## Notifications

When a player submits a result, the opponent's **Confirm** tab gets a badge. It
refreshes two ways:

- **On foreground** — returning to the app is the common case: finish a match,
  put the phone down, come back to the result waiting.
- **Realtime** — a change arrives while the app is already open.

This is deliberately not push notifications. Real push needs APNs and FCM
credentials (paid Apple and Google accounts) before a tester can see anything,
which would block the pilot. Add `expo-notifications` once those accounts exist.

## Partner finder

Browse players who chose to be listed, nearest in rating first. The rating window
is narrow on purpose — someone 300 points away is not a sparring partner, however
keen.

Players set their setup, home city, and the times they are free. **Leaving every
free-time slot off means "any time"**, not "never": hiding a player who never
touched the filter would make them unfindable rather than honest.

A player who sets `rating_visible = false` is not listed. That flag is enforced
only by RLS on a direct `profiles` read, so any future view joining profiles has
to repeat the check — otherwise hidden ratings leak through the join.

## Not built yet

Venue directory, marketplace, video hub, news, club and coach dashboards. These
are all thin once logging and ratings are solid, and the rating is the part that
is genuinely hard to retrofit — every historical result has to recompute
correctly when you change the algorithm.
