# GKD subscription merge

This folder keeps a phone-specific merged GKD subscription.

## Local update

1. Connect the phone and run `update_app_list.ps1` to refresh `packages_all.txt`.
2. Run:

```powershell
node scripts/merge-gkd.mjs --packages packages_all.txt --out dist
```

The merged subscription is written to `dist/merged-gkd.json5`.

The merged file keeps the AIsouler subscription categories and global groups,
while trimming global-group app lists to packages installed on the phone.

## GitHub Actions

`.github/workflows/merge-gkd.yml` runs once per day and refreshes `dist/merged-gkd.json5` from the upstream subscriptions in `sources.json`.
It also runs when the phone package list, source list, or merge script changes on `main`.
