# Open Questions

- Q1: Which monitoring platform (Grafana, DataDog, other) will poll `/tools/get-health-status` so we can tailor payload parsing and alert thresholds?
- Q2: What persistence layer should back the retry queue and shared cache once we scale beyond single-instance memory?
- Q3: Do we need multi-tenant isolation for Matomo credentials or will deployments stay single-tenant per client?
