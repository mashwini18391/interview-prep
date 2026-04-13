/**
 * Basic Deno Type Definitions for VS Code TS Server
 * This helps suppress errors when the Deno extension isn't fully active.
 */

declare namespace Deno {
  export interface ServeOptions {
    port?: number;
    hostname?: string;
    onListen?: (params: { hostname: string; port: number }) => void;
  }

  export function serve(
    handler: (req: Request) => Promise<Response> | Response
  ): void;

  export function serve(
    options: ServeOptions,
    handler: (req: Request) => Promise<Response> | Response
  ): void;

  /**
   * Deno.env interface
   * Using an object type to allow 'delete' which is a reserved keyword
   */
  export const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    toObject(): { [key: string]: string };
  };
}

// Support for standard Request/Response if not in lib
interface Request extends Body {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  json(): Promise<any>;
  text(): Promise<string>;
}

interface Response extends Body {
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly headers: Headers;
}
