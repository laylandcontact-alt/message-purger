# Message Purger

A JS-only Revenge plugin that permanently deletes messages authored by the currently logged-in account, with optional date filters.

## Build

```sh
npm ci
npm run lint:types
npm run package
```

The package command builds `plugins/message-purger/build/js/index.js`, creates `build/dist/message-purger.zip`, and writes the repository index to `docs/index.json`. Set `PLUGIN_REPOSITORY_URL` to override the absolute artifact URL used in the index.