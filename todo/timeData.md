# Time/Date Input Audit

> Scope: User-facing inputs in workflow block `subBlocks` plus UI components used for time/date entry.
> Includes: date/time/timestamp strings, ISO/Unix formats, cron, timezones, natural language time, and durations/offsets.
> Notes: `DateTimeInput` component exists but is not imported anywhere in the app.

---

## Standardized Time Format Family (Picker‑Driven)

- Time/date inputs are now handled via dedicated picker components (`DateTimePicker` / `SimpleTimePicker`) instead of generic text validation.
- Picker outputs are normalized to `YYYY-MM-DD`, `HH:mm:ss`, or full UTC `YYYY-MM-DDTHH:mm:ssZ` depending on the field configuration.
- Generic text inputs no longer enforce time formats; only time-specific input components enforce the canonical formats.

## Picker Outputs

- `TimeInput` stores `HH:mm:ss`.
- `DateTimeInputField` stores `YYYY-MM-DDTHH:mm:ssZ` (or `YYYY-MM-DD` when `hideTime` is set).

## Non‑Picker Time Inputs (Epoch/Relative/Duration)

- Inputs that explicitly use Unix epoch numbers or relative/unit‑suffixed durations remain text/numeric (not ISO date/time).
- Numeric‑only time fields now use `inputType: 'number'` in their subBlock configs (epoch timestamps, timeouts, numeric durations).
- Epoch examples: Datadog `from`/`to` (Unix seconds), Grafana `time`/`timeEnd`/`from`/`to` (epoch ms), Kalshi `minTs`/`maxTs` (ms) + `startTs`/`endTs` (s), Intercom `signed_up_at`/`last_seen_at` (s), Polymarket `startTs`/`endTs` (s), Spotify `position_ms`.
- Relative/duration examples: Datadog `logFrom`/`logTo` (e.g., `now-1h`), Grafana `forDuration` (`5m`), Polymarket `interval` (`1m/1h/1d`), Apify/Elasticsearch/Wait/Zoom/Video Generator timeouts & durations (numeric).

## Time Input Components

- `apps/tradinggoose/components/ui/datetime-picker.tsx` — `DateTimePicker` (date + time, timezone support)
- `apps/tradinggoose/components/ui/simple-time-picker.tsx` — `SimpleTimePicker` (time-only)
- `apps/tradinggoose/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/datetime-input.tsx` — `DateTimeInputField` (stores `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DD`)
- `apps/tradinggoose/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/time-input.tsx` — `TimeInput` (stores `HH:mm:ss`)
- `apps/tradinggoose/components/ui/datetime-input.tsx` — unused in app (no imports found)

---

## Absolute Date/Time/Timestamp Inputs

### Ahrefs
- `apps/tradinggoose/blocks/blocks/ahrefs.ts:44` — `date` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/ahrefs.ts:100` — `date` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/ahrefs.ts:142` — `date` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/ahrefs.ts:198` — `date` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/ahrefs.ts:278` — `date` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/ahrefs.ts:357` — `date` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/ahrefs.ts:446` — `date` (YYYY-MM-DD)

### Apollo
- `apps/tradinggoose/blocks/blocks/apollo.ts:416` — `close_date` (ISO date)
- `apps/tradinggoose/blocks/blocks/apollo.ts:528` — `due_at` (ISO datetime)

### Asana
- `apps/tradinggoose/blocks/blocks/asana.ts:141` — `due_on` (YYYY-MM-DD)

### Calendly
- `apps/tradinggoose/blocks/blocks/calendly.ts:90` — `min_start_time` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/calendly.ts:111` — `max_start_time` (ISO 8601)

### Datadog
- `apps/tradinggoose/blocks/blocks/datadog.ts:96` — `from` (Unix timestamp)
- `apps/tradinggoose/blocks/blocks/datadog.ts:117` — `to` (Unix timestamp)
- `apps/tradinggoose/blocks/blocks/datadog.ts:367` — `end` (Unix timestamp, mute monitor)
- `apps/tradinggoose/blocks/blocks/datadog.ts:411` — `logFrom` (relative time string, e.g. now-1h)
- `apps/tradinggoose/blocks/blocks/datadog.ts:433` — `logTo` (relative time string, e.g. now)
- `apps/tradinggoose/blocks/blocks/datadog.ts:522` — `downtimeStart` (Unix timestamp)
- `apps/tradinggoose/blocks/blocks/datadog.ts:542` — `downtimeEnd` (Unix timestamp)

### Dropbox
- `apps/tradinggoose/blocks/blocks/dropbox.ts:233` — `expires` (ISO datetime)

### Fireflies
- `apps/tradinggoose/blocks/blocks/fireflies.ts:91` — `fromDate` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/fireflies.ts:116` — `toDate` (ISO 8601)

### Google Calendar
- `apps/tradinggoose/blocks/blocks/google_calendar.ts:95` — `startDateTime` (ISO datetime)
- `apps/tradinggoose/blocks/blocks/google_calendar.ts:104` — `endDateTime` (ISO datetime)
- `apps/tradinggoose/blocks/blocks/google_calendar.ts:123` — `timeMin` (ISO datetime)
- `apps/tradinggoose/blocks/blocks/google_calendar.ts:131` — `timeMax` (ISO datetime)
- `apps/tradinggoose/blocks/blocks/google_calendar.ts:173` — `text` (natural language event with time)

### Grafana
- `apps/tradinggoose/blocks/blocks/grafana.ts:455` — `time` (epoch ms)
- `apps/tradinggoose/blocks/blocks/grafana.ts:478` — `timeEnd` (epoch ms)
- `apps/tradinggoose/blocks/blocks/grafana.ts:512` — `from` (epoch ms)
- `apps/tradinggoose/blocks/blocks/grafana.ts:532` — `to` (epoch ms)

### Grain
- `apps/tradinggoose/blocks/blocks/grain.ts:68` — `beforeDatetime` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/grain.ts:92` — `afterDatetime` (ISO 8601)

### Historical Data
- `apps/tradinggoose/blocks/blocks/historical_data.ts:290` — `start` (`datetime-input`)
- `apps/tradinggoose/blocks/blocks/historical_data.ts:299` — `end` (`datetime-input`)

### Incident.io
- `apps/tradinggoose/blocks/blocks/incidentio.ts:592` — `entry_window_start` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/incidentio.ts:612` — `entry_window_end` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/incidentio.ts:665` — `start_at` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/incidentio.ts:686` — `end_at` (ISO 8601)

### Intercom
- `apps/tradinggoose/blocks/blocks/intercom.ts:125` — `signed_up_at` (Unix timestamp)
- `apps/tradinggoose/blocks/blocks/intercom.ts:148` — `last_seen_at` (Unix timestamp)
- `apps/tradinggoose/blocks/blocks/intercom.ts:353` — `remote_created_at` (Unix timestamp)
- `apps/tradinggoose/blocks/blocks/intercom.ts:496` — `reply_created_at` (Unix timestamp)
- `apps/tradinggoose/blocks/blocks/intercom.ts:594` — `ticket_created_at` (Unix timestamp)
- `apps/tradinggoose/blocks/blocks/intercom.ts:735` — `message_created_at` (Unix timestamp)

### Kalshi
- `apps/tradinggoose/blocks/blocks/kalshi.ts:174` — `minTs` (Unix ms)
- `apps/tradinggoose/blocks/blocks/kalshi.ts:194` — `maxTs` (Unix ms)
- `apps/tradinggoose/blocks/blocks/kalshi.ts:231` — `startTs` (Unix seconds)
- `apps/tradinggoose/blocks/blocks/kalshi.ts:252` — `endTs` (Unix seconds)
- `apps/tradinggoose/blocks/blocks/kalshi.ts:422` — `expirationTs` (Unix seconds)

### Mailchimp
- `apps/tradinggoose/blocks/blocks/mailchimp.ts:663` — `scheduleTime` (YYYY-MM-DDTHH:mm:ssZ)

### Mem0
- `apps/tradinggoose/blocks/blocks/mem0.ts:75` — `startDate` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/mem0.ts:86` — `endDate` (YYYY-MM-DD)

### Microsoft Planner
- `apps/tradinggoose/blocks/blocks/microsoft_planner.ts:110` — `dueDateTime` (ISO 8601)

### Pipedrive
- `apps/tradinggoose/blocks/blocks/pipedrive.ts:96` — `updated_since` (ISO datetime)
- `apps/tradinggoose/blocks/blocks/pipedrive.ts:193` — `expected_close_date` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/pipedrive.ts:388` — `start_date` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/pipedrive.ts:407` — `end_date` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/pipedrive.ts:506` — `due_date` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/pipedrive.ts:526` — `due_time` (HH:mm:ss)
- `apps/tradinggoose/blocks/blocks/pipedrive.ts:647` — `expected_close_date` (YYYY-MM-DD)

### Polymarket
- `apps/tradinggoose/blocks/blocks/polymarket.ts:168` — `startTs` (Unix seconds)
- `apps/tradinggoose/blocks/blocks/polymarket.ts:187` — `endTs` (Unix seconds)

### PostHog
- `apps/tradinggoose/blocks/blocks/posthog.ts:245` — `timestamp` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/posthog.ts:415` — `before` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/posthog.ts:435` — `after` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/posthog.ts:794` — `dateMarker` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/posthog.ts:850` — `experimentStartDate` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/posthog.ts:870` — `experimentEndDate` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/posthog.ts:977` — `surveyStartDate` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/posthog.ts:1000` — `surveyEndDate` (ISO 8601)

### Salesforce
- `apps/tradinggoose/blocks/blocks/salesforce.ts:296` — `closeDate` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/salesforce.ts:373` — `activityDate` (YYYY-MM-DD)

### Schedule
- `apps/tradinggoose/blocks/blocks/schedule.ts:60` — `dailyTime` (`time-input`)
- `apps/tradinggoose/blocks/blocks/schedule.ts:85` — `weeklyDayTime` (`time-input`)
- `apps/tradinggoose/blocks/blocks/schedule.ts:102` — `monthlyTime` (`time-input`)
- `apps/tradinggoose/blocks/blocks/schedule.ts:110` — `cronExpression` (cron)

### Sentry
- `apps/tradinggoose/blocks/blocks/sentry.ts:439` — `dateReleased` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/sentry.ts:527` — `dateStarted` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/sentry.ts:548` — `dateFinished` (ISO 8601)

### Slack
- `apps/tradinggoose/blocks/blocks/slack.ts:176` — `oldest` (ISO 8601)

### Trello
- `apps/tradinggoose/blocks/blocks/trello.ts:143` — `due` (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
- `apps/tradinggoose/blocks/blocks/trello.ts:245` — `due` (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)

### Twilio Voice
- `apps/tradinggoose/blocks/blocks/twilio_voice.ts:184` — `startTimeAfter` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/twilio_voice.ts:209` — `startTimeBefore` (YYYY-MM-DD)

### Typeform
- `apps/tradinggoose/blocks/blocks/typeform.ts:57` — `since` (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
- `apps/tradinggoose/blocks/blocks/typeform.ts:65` — `until` (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)

### Wealthbox
- `apps/tradinggoose/blocks/blocks/wealthbox.ts:105` — `dueDate` (YYYY-MM-DDTHH:mm:ssZ)

### X (Twitter)
- `apps/tradinggoose/blocks/blocks/x.ts:117` — `startTime` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/x.ts:125` — `endTime` (ISO 8601)

### Zoom
- `apps/tradinggoose/blocks/blocks/zoom.ts:130` — `startTime` (ISO 8601)
- `apps/tradinggoose/blocks/blocks/zoom.ts:301` — `fromDate` (YYYY-MM-DD)
- `apps/tradinggoose/blocks/blocks/zoom.ts:326` — `toDate` (YYYY-MM-DD)

---

## Durations / Intervals / Offsets

### Apify
- `apps/tradinggoose/blocks/blocks/apify.ts:77` — `timeout` (seconds)
- `apps/tradinggoose/blocks/blocks/apify.ts:91` — `waitForFinish` (seconds)

### Elasticsearch
- `apps/tradinggoose/blocks/blocks/elasticsearch.ts:424` — `timeout` (seconds)

### Fireflies
- `apps/tradinggoose/blocks/blocks/fireflies.ts:336` — `duration` (minutes)
- `apps/tradinggoose/blocks/blocks/fireflies.ts:348` — `startTime` (seconds offset)
- `apps/tradinggoose/blocks/blocks/fireflies.ts:359` — `endTime` (seconds offset)

### Grafana
- `apps/tradinggoose/blocks/blocks/grafana.ts:352` — `forDuration` (e.g., `5m`, `1h`)

### Incident.io
- `apps/tradinggoose/blocks/blocks/incidentio.ts:738` — `path` JSON includes `time_to_ack_seconds`
- `apps/tradinggoose/blocks/blocks/incidentio.ts:750` — `working_hours` JSON includes `start_time`/`end_time`

### Pipedrive
- `apps/tradinggoose/blocks/blocks/pipedrive.ts:546` — `duration` (HH:mm:ss)

### Polymarket
- `apps/tradinggoose/blocks/blocks/polymarket.ts:146` — `interval` (1m/1h/1d/1w/etc)
- `apps/tradinggoose/blocks/blocks/polymarket.ts:161` — `fidelity` (minutes)

### Schedule
- `apps/tradinggoose/blocks/blocks/schedule.ts:42` — `minutesInterval` (minutes)
- `apps/tradinggoose/blocks/blocks/schedule.ts:51` — `hourlyMinute` (0-59)
- `apps/tradinggoose/blocks/blocks/schedule.ts:68` — `weeklyDay` (day-of-week selector)
- `apps/tradinggoose/blocks/blocks/schedule.ts:93` — `monthlyDay` (1-31)

### Spotify
- `apps/tradinggoose/blocks/blocks/spotify.ts:587` — `position_ms` (milliseconds)

### Stripe
- `apps/tradinggoose/blocks/blocks/stripe.ts:290` — `trial_period_days` (days)

### Twilio Voice
- `apps/tradinggoose/blocks/blocks/twilio_voice.ts:100` — `timeout` (seconds)

### Video Generator
- `apps/tradinggoose/blocks/blocks/video_generator.ts:117`
- `apps/tradinggoose/blocks/blocks/video_generator.ts:131`
- `apps/tradinggoose/blocks/blocks/video_generator.ts:146`
- `apps/tradinggoose/blocks/blocks/video_generator.ts:160`
- `apps/tradinggoose/blocks/blocks/video_generator.ts:174`
  - `duration` (seconds)

### Wait
- `apps/tradinggoose/blocks/blocks/wait.ts:26` — `timeValue` (seconds/minutes)
- `apps/tradinggoose/blocks/blocks/wait.ts:36` — `timeUnit` (seconds/minutes)

### Zoom
- `apps/tradinggoose/blocks/blocks/zoom.ts:157` — `duration` (minutes)

---

## Time‑Adjacent Selectors (not time input but time-related controls)

- `apps/tradinggoose/blocks/blocks/schedule.ts:119` — `timezone`
- `apps/tradinggoose/blocks/blocks/incidentio.ts:380` — `timezone`
- `apps/tradinggoose/blocks/blocks/incidentio.ts:442` — `timezone`
- `apps/tradinggoose/blocks/blocks/zoom.ts:168` — `timezone`
- `apps/tradinggoose/blocks/blocks/reddit.ts:77` — `time` (top-sort time filter)
- `apps/tradinggoose/blocks/blocks/spotify.ts:516` — `time_range` (time range filter)
- `apps/tradinggoose/blocks/blocks/trading_action.ts:184` — `timeInForce` (order time-in-force)
- `apps/tradinggoose/blocks/blocks/kalshi.ts:411` — `timeInForce` (order time-in-force)
- `apps/tradinggoose/blocks/blocks/stt.ts:174` — `timestamps` (toggle)

---

## Notes / Gaps

- `apps/tradinggoose/components/ui/datetime-input.tsx` is unused in the current codebase.
- MCP dynamic args (`apps/tradinggoose/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/mcp-dynamic-args/mcp-dynamic-args.tsx`) treat `string` with `format: 'date-time'` as a **short-input** (no dedicated date/time UI).
