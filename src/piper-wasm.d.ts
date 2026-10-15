// The Piper phonemizer is an Emscripten module factory without type declarations.
declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  const createPiperPhonemize: (options: Record<string, unknown>) => Promise<{ callMain(args: string[]): void }>;
  export default createPiperPhonemize;
}
