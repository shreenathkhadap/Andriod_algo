# KPI Report Backend Handoff

The Android KPI implementation is complete on the client side. The backend must be implemented in the existing AWS/external API project. No backend source code is kept in this mobile workspace.

## Required API

Create this endpoint:

```text
POST /api/android/kpi-report
```

Android sends one request per camera and missing time interval:

```json
{
  "camera": "Camera1",
  "from": "2026-09-24T10:00:00",
  "to": "2026-09-24T12:00:00"
}
```

The endpoint must:

1. Validate the Bearer token using the same authentication system as the existing mobile APIs.
2. Validate the camera and date/time range.
3. Read KPI JSON from S3 on the server side.
4. Filter records between `from` and `to`.
5. Return only the requested range.
6. Return a usable frame image URL.
7. Never expose AWS credentials to Android.

## Required Response

```json
{
  "success": true,
  "report": [
    {
      "camera_name": "Camera1",
      "records": [
        {
          "timestamp": "2026-09-24T11:00:00",
          "counts": {
            "person": 2,
            "car": 1
          },
          "frame_link": "https://signed-s3-url"
        }
      ]
    }
  ]
}
```

For an empty result, return the same shape with an empty `records` array. For errors, return an HTTP error status and:

```json
{
  "success": false,
  "message": "Readable error message"
}
```

## S3 Layout

Recommended layout:

```text
kpi-reports/
  Camera1/
    2026-09-24.json
  Camera2/
    2026-09-24.json
```

Each daily file can contain:

```json
{
  "camera_name": "Camera1",
  "records": [
    {
      "timestamp": "2026-09-24T11:00:00",
      "counts": {
        "person": 2,
        "car": 1
      },
      "frame_key": "alert-images/Camera1/2026-09-24/frame-001.jpg"
    }
  ]
}
```

The backend may also return an existing `frame_link`. If the JSON stores `frame_key`, generate a short-lived S3 presigned URL. Do not return `localhost` image URLs to Android.

## AWS Implementation

Recommended architecture:

```text
API Gateway -> Lambda -> S3 KPI JSON
                         -> S3 frame image -> presigned URL
```

The Lambda execution role needs only the required S3 read permissions, for example:

```text
s3:GetObject on the KPI JSON prefix
s3:GetObject on the frame-image prefix
```

Keep the S3 bucket private. Do not add AWS access keys to the mobile app or commit them to source control.

## Backend Processing

For a request:

1. Convert `from` and `to` to comparable timestamps.
2. Locate only the S3 daily files that overlap the requested dates.
3. Parse and filter records by timestamp.
4. Return the matching camera records and frame links.
5. Enforce a maximum 24-hour range to match the Android cache behavior.

The Android repository handles the rolling cache, missing intervals, SQLite upserts, duplicate prevention, and final SQLite query. The backend only needs to return the requested interval correctly.

## Integration With Android

The Android code calls the URL configured by:

```env
EXPO_PUBLIC_KPI_REPORT_URL=https://your-api-domain/api/android/kpi-report
```

If this variable is not set, the app falls back to:

```text
${EXPO_PUBLIC_GATEWAY_URL}/api/android/kpi-report
```

Relevant Android files:

- `src/utils/alertStorage.js`: calls the API and stores KPI records.
- `src/screens/KpiReportScreen.jsx`: collects filters and displays results.
- `src/utils/db.js`: creates the local KPI tables.
- `src/screens/Admin/InsightScreen.jsx`: exposes the KPI Report tab.

## Backend Verification Checklist

- [ ] S3 bucket and KPI prefix confirmed.
- [ ] KPI JSON structure confirmed.
- [ ] API Gateway route deployed.
- [ ] Lambda reads S3 successfully.
- [ ] Bearer authentication works with the Android token.
- [ ] Date/time filtering is correct.
- [ ] Multiple object counts are returned correctly.
- [ ] Presigned frame URLs open on a physical Android device.
- [ ] Empty results return `success: true` with `records: []`.
- [ ] Invalid requests return useful 4xx responses.
- [ ] Android is configured with the deployed endpoint.

## Android Trace Map

These are the current line ranges to trace the Android implementation from the UI to the external backend. Line numbers can change after formatting or edits, so use the symbol names together with the ranges.

| File                                       |   Lines | What to trace                                                                          |
| ------------------------------------------ | ------: | -------------------------------------------------------------------------------------- |
| `src/screens/Admin/InsightScreen.jsx`      |   21-27 | Defines the Insights tabs, including `KPI Report`.                                     |
| `src/screens/Admin/InsightScreen.jsx`      | 174-180 | Renders `KpiReportScreen` and passes the token/API URL.                                |
| `src/screens/KpiReportScreen.jsx`          |   18-45 | Defines camera, date, time, records, loading, and error state.                         |
| `src/screens/KpiReportScreen.jsx`          |  67-116 | Validates the selected range and calls `getKpiReport`.                                 |
| `src/screens/KpiReportScreen.jsx`          | 229-231 | Displays the returned `frame_link` image.                                              |
| `src/utils/db.js`                          |   72-86 | Detects and migrates the previous KPI schema.                                          |
| `src/utils/db.js`                          | 112-135 | Creates `kpi_records`, indexes, and `kpi_cache_windows`.                               |
| `src/utils/alertStorage.js`                | 226-243 | Reads synchronized cache-window coverage.                                              |
| `src/utils/alertStorage.js`                | 245-259 | Calculates missing intervals.                                                          |
| `src/utils/alertStorage.js`                | 261-286 | Calls `POST /api/android/kpi-report`.                                                  |
| `src/utils/alertStorage.js`                | 288-310 | Parses `camera_name`, `records`, `counts`, and `frame_link`.                           |
| `src/utils/alertStorage.js`                | 312-333 | Upserts normalized KPI rows into SQLite.                                               |
| `src/utils/alertStorage.js`                | 336-347 | Marks a successfully fetched interval as cached.                                       |
| `src/utils/alertStorage.js`                | 350-359 | Queries final KPI records from SQLite.                                                 |
| `src/utils/alertStorage.js`                | 362-390 | Removes records and cache windows outside the rolling range.                           |
| `src/utils/alertStorage.js`                | 393-410 | Synchronizes each camera's missing intervals.                                          |
| `src/utils/alertStorage.js`                | 413-445 | Coordinates cache checks, API fallback, cleanup, and final query.                      |
| `src/components/insight/AlertReportRN.jsx` | 701-735 | Existing alert image mapping; alerts use `imageUrl`, separately from KPI `frame_link`. |

## External Backend Trace Targets

The Android code expects these backend responsibilities outside this workspace:

| Backend responsibility | Android caller                      | Required backend action                                                                        |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Endpoint               | `alertStorage.js` lines 261-286     | Implement `POST /api/android/kpi-report`.                                                      |
| Request body           | `alertStorage.js` lines 399-406     | Accept `camera`, `from`, and `to`.                                                             |
| Authentication         | `alertStorage.js` lines 274-280     | Validate the Bearer token sent by Android.                                                     |
| S3 JSON lookup         | No Android file                     | Read the KPI JSON from the configured S3 prefix.                                               |
| Date filtering         | No Android file                     | Return records only between `from` and `to`.                                                   |
| Frame URL              | `KpiReportScreen.jsx` lines 229-231 | Return a public or presigned `frame_link`.                                                     |
| Response shape         | `alertStorage.js` lines 288-310     | Return `success`, `report`, `camera_name`, `records`, `timestamp`, `counts`, and `frame_link`. |
