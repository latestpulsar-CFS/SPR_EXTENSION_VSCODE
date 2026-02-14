[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)

# SPHER Governor VS Code Extension

Extension VS Code dediee a la gouvernance des actions IA via SPHER/CFS local.

## Objectif

- Forcer un chemin gouverne pour les actions IA.
- Bloquer toute mutation directe hors pipeline AM/CFS.
- Exposer et tracer les preuves CFS/SPHER (etat + compute events).

## Etat actuel (MVP+)

- Commandes VS Code:
  - `SPHER: Connect Local`
  - `SPHER: Set API Token`
  - `SPHER: Run Governed Action`
  - `SPHER: Toggle Strict Mode`
  - `SPHER: Show Proof`
  - `SPHER: Export Audit`
- Panel `SPHER Control`:
  - etat SPHER
  - terminal compute (polling)
- Policy locale:
  - classification `read_only` vs `mutating`
  - fail-closed attendu en strict
- Chemin mutating gouverne:
  - prompt PR1MUS
  - execution via `am-agent` (`AM::PRIORITY::REQUEST` puis `AM::PRIORITY::AUTH`)
  - fallback optionnel `cargo run --manifest-path ... --bin am-agent -- "..."`
- Audit local JSONL dans `globalStorageUri/audit.jsonl`

## Prerequis

- Service AM Orch local actif sur `http://127.0.0.1:7072`
- `am-agent` dispo dans PATH, ou cargo fallback configure
- Node.js + npm installes

## Build

```powershell
npm install
npm run compile
```

Puis lancer l'extension en mode dev depuis VS Code (`F5`).

## Settings

- `spher.baseUrl`
- `spher.strictMode`
- `spher.httpReadOnly`
- `spher.apiUser`
- `spher.amAgentPath`
- `spher.allowCargoFallback`
- `spher.orchestratorManifestPath`
- `spher.pollMs`
- `spher.computeUiUrl`
- `spher.dataphyEnabled`
- `spher.dataphyCliPath`
- `spher.dataphyTimeoutMs`
- `spher.dataphyUseCargoFallback`
- `spher.dataphyManifestPath`
- `spher.dataphyCwd`

## Notes de securite

- L'extension ne doit pas executer de mutation shell directe.
- Les mutations passent par AM/CFS avec preuve.
- Le token API est stocke dans VS Code SecretStorage.


- `spher.computeUiUrl` (ex: `http://127.0.0.1:7191/ui/compute`)

