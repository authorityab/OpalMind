declare module 'js-yaml' {
  interface LoadOptions {
    filename?: string;
    json?: boolean;
    onWarning?(error: Error): void;
    schema?: unknown;
  }

  export function load(content: string, options?: LoadOptions): unknown;
}
