declare module 'jsonwebtoken' {
  export function sign(
    payload: string | object | Buffer,
    secretOrPrivateKey: string | Buffer,
    options?: Record<string, unknown>
  ): string;
  export function verify(
    token: string,
    secretOrPublicKey: string | Buffer,
    options?: Record<string, unknown>
  ): Record<string, unknown> | string;
  const _default: { sign: typeof sign; verify: typeof verify };
  export default _default;
}
