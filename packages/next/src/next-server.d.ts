declare module 'next/server' {
  export class NextRequest extends Request {
    readonly nextUrl: URL & { clone(): URL & { pathname: string } };
    readonly cookies: {
      get(name: string): { value: string } | undefined;
    };
  }

  export class NextResponse extends Response {
    static next(): NextResponse;
    static redirect(url: URL): NextResponse;
  }
}
