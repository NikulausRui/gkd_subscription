# GKD subscription merge

This folder keeps a phone-specific merged GKD subscription.

## Local update

1. Connect the phone and run `update_app_list.ps1` to refresh `packages_all.txt`.
2. Run:

```powershell
node scripts/merge-gkd.mjs --packages packages_all.txt --out dist
```

The merged subscription is written to `dist/merged-gkd.json5`.

## GitHub Actions

`.github/workflows/merge-gkd.yml` runs once per day and refreshes `dist/merged-gkd.json5` from the upstream subscriptions in `sources.json`.
