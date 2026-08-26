declare module "@revenge-mod/modules/finders" {
    export function lookupModule(filter: unknown): readonly [unknown, unknown] | readonly [];
}

declare module "@revenge-mod/modules/finders/filters" {
    export function withProps(...props: string[]): unknown;
}

declare function plugin(options: {
    SettingsComponent?: (props: { api: unknown }) => unknown;
    start?: (api: unknown) => unknown;
    stop?: (api: unknown) => unknown;
}): unknown;
