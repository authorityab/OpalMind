# Sample Tool Responses

These examples assume the service is running locally on `http://localhost:4000` with the default bearer token `change-me`.

## GetKeyNumbers

**Request**
```bash
curl -X POST http://localhost:4000/tools/get-key-numbers \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{"period":"day","date":"today"}}'
```

**Response**
```json
{
  "nb_visits": 0,
  "nb_uniq_visitors": 0,
  "nb_actions": 0,
  "nb_users": 0,
  "nb_visits_converted": 0,
  "sum_visit_length": 0,
  "max_actions": 0,
  "bounce_rate": "0%",
  "nb_actions_per_visit": 0,
  "bounce_count": 0,
  "avg_time_on_site": 0
}
```

## GetMostPopularUrls

**Request**
```bash
curl -X POST http://localhost:4000/tools/get-most-popular-urls \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{"period":"week","date":"today","limit":5}}'
```

**Example Response**
```json
[
  {
    "label": "/",
    "url": "https://example.com/",
    "nb_hits": 42,
    "nb_visits": 37,
    "nb_uniq_visitors": 35,
    "sum_time_spent": 912
  },
  {
    "label": "/blog/hello-world",
    "url": "https://example.com/blog/hello-world",
    "nb_hits": 15,
    "nb_visits": 12,
    "nb_uniq_visitors": 10,
    "sum_time_spent": 301
  }
]
```

## GetTopReferrers

**Request**
```bash
curl -X POST http://localhost:4000/tools/get-top-referrers \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{"period":"week","date":"today","limit":5}}'
```

**Example Response**
```json
[
  {
    "label": "Search Engines",
    "nb_visits": 21,
    "nb_actions": 54,
    "nb_visits_converted": 2
  },
  {
    "label": "Websites",
    "nb_visits": 9,
    "nb_actions": 17,
    "nb_visits_converted": 1
  }
]
```

## GetEntryPages

**Request**
```bash
curl -X POST http://localhost:4000/tools/get-entry-pages \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{"period":"day","date":"2025-09-01","limit":5}}'
```

**Example Response**
```json
[
  {
    "label": "/community/events/events-035",
    "url": "https://example.com/community/events/events-035",
    "nb_visits": 99,
    "nb_uniq_visitors": 96,
    "entry_nb_visits": 26,
    "entry_nb_actions": 120,
    "entry_bounce_count": 3,
    "sum_time_spent": 91,
    "avg_time_on_page": 1,
    "bounce_rate": "12%",
    "exit_rate": "21%"
  },
  {
    "label": "/blog/announcements/announcements-010",
    "url": "https://example.com/blog/announcements/announcements-010",
    "nb_visits": 96,
    "nb_uniq_visitors": 88,
    "entry_nb_visits": 21,
    "entry_nb_actions": 98,
    "entry_bounce_count": 3,
    "sum_time_spent": 99,
    "avg_time_on_page": 1,
    "bounce_rate": "14%",
    "exit_rate": "23%"
  }
]
```

## GetCampaigns

**Request**
```bash
curl -X POST http://localhost:4000/tools/get-campaigns \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{"period":"month","date":"2025-01-01","limit":5}}'
```

**Example Response**
```json
[
  {
    "label": "Winter Sale",
    "nb_visits": 120,
    "nb_actions": 265,
    "nb_visits_converted": 18,
    "revenue": 5400
  },
  {
    "label": "Retargeting",
    "nb_visits": 84,
    "nb_actions": 143,
    "nb_visits_converted": 9,
    "revenue": 2250
  }
]
```

## TrackPageview

**Request**
```bash
curl -X POST http://localhost:4000/track/pageview \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{"url":"https://example.com/","actionName":"Homepage"}}'
```

**Response**
```json
{
  "ok": true,
  "status": 204,
  "pvId": "abcdef1234567890"
}
```

## TrackEvent

**Request**
```bash
curl -X POST http://localhost:4000/track/event \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{"category":"CTA","action":"click","value":1}}'
```

**Response**
```json
{
  "ok": true,
  "status": 204
}
```

## TrackGoal

**Request**
```bash
curl -X POST http://localhost:4000/track/goal \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{"goalId":5,"revenue":10.5}}'
```

**Response**
```json
{
  "ok": true,
  "status": 204
}
```

> Tip: Use segments or different date/period combinations to explore other datasets while testing.
